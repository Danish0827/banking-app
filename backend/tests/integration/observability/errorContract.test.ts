import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request, { type Response } from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { cookieHeader } from "../../helpers/auth.js";
import { resetDatabase } from "../../helpers/database.js";
import {
  addAccount,
  createCustomerWithAccount,
  postMovement,
  type TestCustomer,
} from "../../helpers/money.js";

/**
 * Every error the API can return, whatever produced it (validation,
 * middleware, router, service or an unexpected exception), must have the
 * same shape and carry the request id that is also in the response header.
 */
function expectErrorContract(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers["content-type"]).toMatch(/^application\/json/);
  expect(Object.keys(res.body)).toEqual(["error"]);

  const { error } = res.body as { error: Record<string, unknown> };
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe("string");
  expect(error.requestId).toBe(res.headers["x-request-id"]);
  for (const key of Object.keys(error)) {
    expect(["code", "message", "details", "requestId"]).toContain(key);
  }
  expect(res.text).not.toMatch(/stack|at [\w.<>]+ \(|node_modules|\.ts:\d+/);
}

describe("error response contract", () => {
  let app: Express;
  let customer: TestCustomer;
  let otherCustomer: TestCustomer;

  beforeAll(async () => {
    await resetDatabase();
    app = createApp();
    customer = await createCustomerWithAccount(1_000);
    otherCustomer = await createCustomerWithAccount(1_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("400 validation error", async () => {
    const res = await postMovement(
      app,
      "deposits",
      customer.accountId,
      { amount: -1 },
      {
        cookie: customer.cookie,
      },
    );

    expectErrorContract(res, 400, "VALIDATION_ERROR");
    expect(res.body.error.details).toEqual([
      { path: "amount", message: "Amount must be greater than zero" },
    ]);
  });

  it("400 malformed JSON", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{");

    expectErrorContract(res, 400, "INVALID_JSON");
  });

  it("401 authentication error", async () => {
    expectErrorContract(await request(app).get("/api/v1/accounts"), 401, "UNAUTHENTICATED");
    expectErrorContract(
      await request(app).get("/api/v1/accounts").set("Cookie", cookieHeader("forged")),
      401,
      "UNAUTHENTICATED",
    );
  });

  it("401 invalid credentials", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: "wrong" });

    expectErrorContract(res, 401, "INVALID_CREDENTIALS");
  });

  it("403 cross-origin write", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: "a@example.com", password: "x" });

    expectErrorContract(res, 403, "ORIGIN_NOT_ALLOWED");
  });

  it("404 for another customer's account (authorization)", async () => {
    const res = await request(app)
      .get(`/api/v1/accounts/${otherCustomer.accountId}`)
      .set("Cookie", customer.cookie);

    expectErrorContract(res, 404, "ACCOUNT_NOT_FOUND");
  });

  it("404 unknown route", async () => {
    expectErrorContract(await request(app).get("/api/v1/nope"), 404, "NOT_FOUND");
    expectErrorContract(await request(app).get("/not-the-api"), 404, "NOT_FOUND");
  });

  it("405 wrong method", async () => {
    const res = await request(app).delete("/api/v1/health");

    expectErrorContract(res, 405, "METHOD_NOT_ALLOWED");
  });

  it("409 idempotency conflict", async () => {
    const options = { cookie: customer.cookie, idempotencyKey: `conflict-${randomUUID()}` };
    await postMovement(app, "deposits", customer.accountId, { amount: 100 }, options);

    const res = await postMovement(app, "deposits", customer.accountId, { amount: 200 }, options);

    expectErrorContract(res, 409, "IDEMPOTENCY_CONFLICT");
  });

  it("413 oversized body", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "a@example.com", password: "x".repeat(20_000) });

    expectErrorContract(res, 413, "PAYLOAD_TOO_LARGE");
  });

  it("415 non-JSON body", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "text/plain")
      .send("hello");

    expectErrorContract(res, 415, "UNSUPPORTED_MEDIA_TYPE");
  });

  it("422 business rule", async () => {
    const savings = await addAccount(customer.customerId, 0);

    const res = await postMovement(
      app,
      "withdrawals",
      savings,
      { amount: 1 },
      {
        cookie: customer.cookie,
      },
    );

    expectErrorContract(res, 422, "INSUFFICIENT_FUNDS");
  });

  it("429 rate limited", async () => {
    const limited = createApp({ moneyRateLimitPerMinute: 1 });
    await postMovement(
      limited,
      "deposits",
      customer.accountId,
      { amount: 1 },
      {
        cookie: customer.cookie,
      },
    );

    const res = await postMovement(
      limited,
      "deposits",
      customer.accountId,
      { amount: 1 },
      {
        cookie: customer.cookie,
      },
    );

    expectErrorContract(res, 429, "RATE_LIMITED");
  });

  it("500 unexpected error, without internals", async () => {
    const query = pool.query.bind(pool);
    vi.spyOn(pool, "query").mockImplementation(((sql: unknown, params?: unknown) => {
      if (typeof sql === "string" && sql.includes("FROM accounts")) {
        return Promise.reject(new Error("relation does not exist at /srv/app/db.ts:12"));
      }
      return query(sql as string, params as unknown[]);
    }) as typeof pool.query);

    const res = await request(app).get("/api/v1/accounts").set("Cookie", customer.cookie);

    expectErrorContract(res, 500, "INTERNAL_ERROR");
    expect(res.body.error.message).toBe("An unexpected error occurred");
    expect(res.text).not.toContain("relation");
    expect(res.text).not.toContain("/srv/app");
  });

  it("503 not ready", async () => {
    const notReady = createApp({
      readiness: { checkDatabase: () => Promise.reject(new Error("down")) },
    });

    expectErrorContract(
      await request(notReady).get("/api/v1/health/ready"),
      503,
      "SERVICE_UNAVAILABLE",
    );
  });
});
