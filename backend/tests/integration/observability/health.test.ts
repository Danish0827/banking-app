import request from "supertest";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/app.js";
import { checkDatabaseConnection, createPool, pool } from "../../../src/db/pool.js";

// A pool aimed at a port nothing listens on: the real "database is down" path.
const unreachable = createPool("postgres://bank:not-the-real-password@127.0.0.1:1/bank_test", 1);

describe("health and readiness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await unreachable.end();
  });

  describe("GET /api/v1/health (liveness)", () => {
    it("answers 200 without a session", async () => {
      const res = await request(createApp()).get("/api/v1/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { status: "ok" } });
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("does not touch the database", async () => {
      const query = vi.spyOn(pool, "query");

      await request(createApp()).get("/api/v1/health");

      expect(query).not.toHaveBeenCalled();
    });

    it("stays up when the database is down", async () => {
      const app = createApp({
        readiness: { checkDatabase: () => checkDatabaseConnection(unreachable) },
      });

      expect((await request(app).get("/api/v1/health")).status).toBe(200);
    });
  });

  describe("GET /api/v1/health/ready (readiness)", () => {
    it("answers 200 when PostgreSQL is reachable", async () => {
      const res = await request(createApp()).get("/api/v1/health/ready");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { status: "ready", checks: { database: "ok" } } });
    });

    it("needs no session", async () => {
      const res = await request(createApp()).get("/api/v1/health/ready").set("Cookie", "");

      expect(res.status).toBe(200);
    });

    it("answers 503 when PostgreSQL is unreachable, revealing nothing about it", async () => {
      const app = createApp({
        readiness: { checkDatabase: () => checkDatabaseConnection(unreachable) },
      });

      const res = await request(app).get("/api/v1/health/ready");

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Service is not ready",
          details: { checks: { database: "unavailable" } },
          requestId: expect.any(String),
        },
      });
      for (const secret of [
        "127.0.0.1",
        "ECONNREFUSED",
        "not-the-real-password",
        "bank",
        "postgres",
      ]) {
        expect(res.text).not.toContain(secret);
      }
    });

    it("answers 503 within its timeout when the database hangs", async () => {
      const app = createApp({
        readiness: { checkDatabase: () => new Promise<void>(() => {}), timeoutMs: 50 },
      });

      const started = Date.now();
      const res = await request(app).get("/api/v1/health/ready");

      expect(res.status).toBe(503);
      expect(Date.now() - started).toBeLessThan(2_000);
    });

    it("answers 503 once shutdown has begun, without checking the database", async () => {
      const checkDatabase = vi.fn(() => Promise.resolve());
      const app = createApp({ readiness: { checkDatabase, isShuttingDown: () => true } });

      const res = await request(app).get("/api/v1/health/ready");

      expect(res.status).toBe(503);
      expect(res.body.error.details).toEqual({ status: "shutting_down" });
      expect(checkDatabase).not.toHaveBeenCalled();
    });

    it("refuses other methods", async () => {
      const res = await request(createApp()).post("/api/v1/health/ready");

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe("GET, HEAD");
    });
  });
});
