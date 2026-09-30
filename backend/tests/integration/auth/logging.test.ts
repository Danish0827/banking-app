import { Writable } from "node:stream";
import { pino } from "pino";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { seedDatabase } from "../../../src/db/seed/seed.js";
import { DEMO_PASSWORD } from "../../../src/db/seed/seedData.js";
import { ALICE, cookieHeader, sessionToken } from "../../helpers/auth.js";
import { resetDatabase } from "../../helpers/database.js";

/** An app whose log output is captured in memory, at the most verbose level. */
function appWithCapturedLogs() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const app = createApp({ logger: pino({ level: "trace" }, destination) });

  return {
    app,
    output: () => lines.join(""),
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("request logging", () => {
  beforeAll(async () => {
    await resetDatabase();
    await seedDatabase({ bcryptRounds: 4 });
  });

  it("does not write passwords, tokens, cookies or hashes to the logs", async () => {
    const { app, output, entries } = appWithCapturedLogs();
    const { rows } = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM customers WHERE id = $1",
      [ALICE.id],
    );
    const passwordHash = rows[0]?.password_hash as string;

    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ALICE.email, password: "a-wrong-password-attempt" });
    const loginRes = await request(app)
      .post("/api/v1/auth/login?next=query-string-value")
      .set("Authorization", "Bearer authorization-header-value")
      .send({ email: ALICE.email, password: DEMO_PASSWORD });
    const token = sessionToken(loginRes);
    await request(app).get("/api/v1/auth/me").set("Cookie", cookieHeader(token));
    await request(app).get("/api/v1/auth/me").set("Cookie", cookieHeader("an-invalid-token-value"));
    await request(app).post("/api/v1/auth/logout").set("Cookie", cookieHeader(token));

    const logged = output();
    expect(entries()).toHaveLength(5);

    for (const secret of [
      DEMO_PASSWORD,
      "a-wrong-password-attempt",
      token,
      token.split(".")[2] as string,
      "an-invalid-token-value",
      "authorization-header-value",
      "query-string-value",
      passwordHash,
    ]) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).not.toMatch(/cookie|authorization|password|headers/i);
  });

  it("logs the method, path, status and authenticated customer of each request", async () => {
    const { app, entries } = appWithCapturedLogs();

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ALICE.email, password: DEMO_PASSWORD });
    await request(app)
      .get("/api/v1/auth/me?ignored=1")
      .set("Cookie", cookieHeader(sessionToken(loginRes)));

    const [loginEntry, meEntry] = entries();
    expect(loginEntry).toMatchObject({
      req: { id: expect.any(String), method: "POST", path: "/api/v1/auth/login" },
      res: { statusCode: 200 },
    });
    expect(Object.keys(loginEntry?.req as object).sort()).toEqual(["id", "method", "path"]);
    expect(meEntry).toMatchObject({
      req: { method: "GET", path: "/api/v1/auth/me" },
      res: { statusCode: 200 },
      customerId: ALICE.id,
    });
  });
});
