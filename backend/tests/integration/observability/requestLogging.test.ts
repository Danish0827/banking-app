import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/app.js";
import { SERVICE_NAME, serializeError } from "../../../src/config/logger.js";
import { pool } from "../../../src/db/pool.js";
import { seedDatabase } from "../../../src/db/seed/seed.js";
import { DEMO_PASSWORD } from "../../../src/db/seed/seedData.js";
import { ALICE, BOB, sessionToken } from "../../helpers/auth.js";
import { resetDatabase } from "../../helpers/database.js";
import { captureLogs, LEVEL } from "../../helpers/logs.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("request correlation and access logging", () => {
  beforeAll(async () => {
    await resetDatabase();
    await seedDatabase({ bcryptRounds: 4 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request ids", () => {
    it("generates a random UUID for every request, unique per request", async () => {
      const app = createApp();
      const ids = await Promise.all(
        Array.from(
          { length: 5 },
          async () => (await request(app).get("/api/v1/health")).headers["x-request-id"],
        ),
      );

      for (const id of ids) expect(id).toMatch(UUID);
      expect(new Set(ids).size).toBe(5);
    });

    it("reuses a safe client id end to end: header, error body and every log line", async () => {
      const logs = captureLogs();
      const app = createApp({ logger: logs.logger });

      const res = await request(app).get("/api/v1/accounts").set("X-Request-Id", "client-trace-42");

      expect(res.headers["x-request-id"]).toBe("client-trace-42");
      expect(res.body.error.requestId).toBe("client-trace-42");
      const lines = logs.entries().filter((line) => line.req);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect((line.req as { id: string }).id).toBe("client-trace-42");
      }
    });

    it("replaces an unsafe client id instead of logging or echoing it", async () => {
      const logs = captureLogs();
      const app = createApp({ logger: logs.logger });

      const res = await request(app)
        .get("/api/v1/health")
        .set("X-Request-Id", '","level":60,"msg":"forged');

      expect(res.headers["x-request-id"]).toMatch(UUID);
      expect(logs.text()).not.toContain("forged");
    });

    it("ties the error log of an unexpected failure to the same request id", async () => {
      const logs = captureLogs();
      const app = createApp({ logger: logs.logger });
      const query = pool.query.bind(pool);
      vi.spyOn(pool, "query").mockImplementation(((sql: unknown, params?: unknown) => {
        if (typeof sql === "string" && sql.includes("FROM accounts")) {
          return Promise.reject(new Error("boom"));
        }
        return query(sql as string, params as unknown[]);
      }) as typeof pool.query);
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: ALICE.email, password: DEMO_PASSWORD });

      const res = await request(app)
        .get("/api/v1/accounts")
        .set("Cookie", `session=${sessionToken(login)}`);

      const id = res.headers["x-request-id"];
      const failure = logs.entries().filter((line) => (line.req as { id?: string })?.id === id);
      expect(failure.map((line) => line.msg)).toEqual(["Unhandled error", "request failed"]);
      expect(failure.every((line) => line.level === LEVEL.error)).toBe(true);
    });
  });

  describe("access log lines", () => {
    it("record id, method, path, status, duration and error code, at the right level", async () => {
      const logs = captureLogs();
      const app = createApp({ logger: logs.logger });

      await request(app).get("/api/v1/health/ready?probe=1");
      await request(app).get("/api/v1/accounts?secret=query-value");
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: ALICE.email, password: DEMO_PASSWORD });

      const lines = logs.accessLines();
      expect(lines).toHaveLength(3);
      const [ready, unauthenticated, login] = lines;
      for (const line of lines) {
        expect(line).toMatchObject({
          service: SERVICE_NAME,
          env: "test",
          req: { id: expect.any(String), method: expect.any(String), path: expect.any(String) },
          res: { statusCode: expect.any(Number) },
          durationMs: expect.any(Number),
        });
        expect(line.durationMs as number).toBeGreaterThanOrEqual(0);
        expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }

      // Healthy probes are debug, so they don't flood production logs.
      expect(ready).toMatchObject({ level: LEVEL.debug, msg: "request completed" });
      expect(ready?.req).toEqual(expect.objectContaining({ path: "/api/v1/health/ready" }));

      // Client errors are info, classified by the code the client received.
      expect(unauthenticated).toMatchObject({
        level: LEVEL.info,
        msg: "request failed",
        errorCode: "UNAUTHENTICATED",
        res: { statusCode: 401 },
      });
      expect(unauthenticated?.req).toEqual({
        id: expect.any(String),
        method: "GET",
        path: "/api/v1/accounts",
      });

      expect(login).toMatchObject({
        level: LEVEL.info,
        msg: "request completed",
        res: { statusCode: 200 },
      });
      expect(login?.errorCode).toBeUndefined();
      expect(logs.text()).not.toContain("query-value");
    });

    it("log a failed readiness probe at error level, without database details", async () => {
      const logs = captureLogs();
      const app = createApp({
        logger: logs.logger,
        readiness: {
          checkDatabase: () =>
            Promise.reject(new Error("connect to postgres://bank:hunter2@db.internal:5432 failed")),
        },
      });

      await request(app).get("/api/v1/health/ready");

      expect(logs.accessLines()[0]).toMatchObject({
        level: LEVEL.error,
        errorCode: "SERVICE_UNAVAILABLE",
        res: { statusCode: 503 },
      });
      expect(logs.text()).not.toContain("hunter2");
      expect(logs.text()).toContain("postgres://***@db.internal");
    });

    it("never contain credentials, tokens, amounts, balances, account numbers or keys", async () => {
      const logs = captureLogs();
      const app = createApp({ logger: logs.logger });
      const key = `observability-${randomUUID()}`;
      const { rows } = await pool.query<{ account_number: string }>(
        "SELECT account_number FROM accounts WHERE customer_id = $1",
        [ALICE.id],
      );

      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: ALICE.email, password: "wrong-pass-123" });
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: ALICE.email, password: DEMO_PASSWORD });
      const token = sessionToken(login);
      const cookie = `session=${token}`;
      const checking = ALICE.accounts[0]?.id as string;
      const deposit = await request(app)
        .post(`/api/v1/accounts/${checking}/deposits`)
        .set("Cookie", cookie)
        .set("Idempotency-Key", key)
        .send({ amount: 765_432 });
      await request(app)
        .post(`/api/v1/accounts/${checking}/transfers`)
        .set("Cookie", cookie)
        .set("Idempotency-Key", `${key}-t`)
        .set("Authorization", "Bearer should-not-be-logged")
        .send({ destinationAccountId: BOB.accounts[0]?.id, amount: 234_567 });
      await request(app).get("/api/v1/transactions").set("Cookie", cookie);
      await request(app).post("/api/v1/auth/logout").set("Cookie", cookie);

      const logged = logs.text();
      expect(deposit.status).toBe(201);
      for (const secret of [
        DEMO_PASSWORD,
        "wrong-pass-123",
        token,
        key,
        "765432",
        "234567",
        String(deposit.body.data.account.balance),
        "should-not-be-logged",
        ...rows.map((row) => row.account_number),
      ]) {
        expect(logged).not.toContain(secret);
      }
      expect(logged).not.toMatch(/cookie|authorization|password|idempotency|amount|balance/i);
      // One line per request: failed login, login, deposit, transfer, history, logout.
      expect(logs.accessLines()).toHaveLength(6);
    });
  });

  describe("error serialization", () => {
    it("masks credentials in URLs and drops database row details", () => {
      const err = Object.assign(
        new Error("could not connect to postgres://bank:s3cret@db:5432/bank"),
        {
          code: "08001",
          detail: "Failing row contains (1000000001, 250000).",
          where: "SQL statement",
          hint: "check the row",
        },
      );

      const serialized = serializeError(err) as Record<string, unknown>;

      expect(serialized.message).toBe("could not connect to postgres://***@db:5432/bank");
      expect(String(serialized.stack)).not.toContain("s3cret");
      expect(serialized.code).toBe("08001");
      expect(serialized).not.toHaveProperty("detail");
      expect(serialized).not.toHaveProperty("where");
      expect(serialized).not.toHaveProperty("hint");
    });

    it("passes non-error values through unchanged", () => {
      expect(serializeError("plain text")).toBe("plain text");
    });
  });
});
