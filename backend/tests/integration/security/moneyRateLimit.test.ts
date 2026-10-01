import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { resetDatabase } from "../../helpers/database.js";
import {
  addAccount,
  balanceOf,
  createCustomerWithAccount,
  postMovement,
  postTransfer,
  type TestCustomer,
} from "../../helpers/money.js";

const LIMIT = 3;

describe("money movement rate limiting", () => {
  let app: Express;
  let customer: TestCustomer;
  let savings: string;

  beforeEach(async () => {
    await resetDatabase();
    // A small explicit limit keeps the test fast and deterministic; the
    // default (MONEY_RATE_LIMIT_PER_MINUTE) is 30 per minute.
    app = createApp({ moneyRateLimitPerMinute: LIMIT });
    customer = await createCustomerWithAccount(10_000);
    savings = await addAccount(customer.customerId, 0);
  });

  const deposit = (who: TestCustomer, amount = 100) =>
    postMovement(app, "deposits", who.accountId, { amount }, { cookie: who.cookie });

  it("allows the configured number of operations, then answers 429 without moving money", async () => {
    for (let index = 0; index < LIMIT; index += 1) {
      expect((await deposit(customer)).status).toBe(201);
    }
    const before = await balanceOf(customer.accountId);

    const res = await deposit(customer);

    expect(res.status).toBe(429);
    expect(res.body.error).toEqual({
      code: "RATE_LIMITED",
      message: "Too many attempts. Please try again later.",
      details: { retryAfterSeconds: expect.any(Number) },
      requestId: expect.any(String),
    });
    expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.body.error.details.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(await balanceOf(customer.accountId)).toBe(before);
  });

  it("counts deposits, withdrawals and transfers together", async () => {
    expect((await deposit(customer)).status).toBe(201);
    expect(
      (
        await postMovement(
          app,
          "withdrawals",
          customer.accountId,
          { amount: 100 },
          {
            cookie: customer.cookie,
          },
        )
      ).status,
    ).toBe(201);
    expect(
      (await postTransfer(app, customer.accountId, savings, 100, { cookie: customer.cookie }))
        .status,
    ).toBe(201);

    const res = await postTransfer(app, customer.accountId, savings, 100, {
      cookie: customer.cookie,
    });

    expect(res.status).toBe(429);
    expect(await balanceOf(savings)).toBe(100);
  });

  it("counts invalid requests, so they cannot be used to probe without limit", async () => {
    for (let index = 0; index < LIMIT; index += 1) {
      expect((await deposit(customer, -1)).status).toBe(400);
    }

    expect((await deposit(customer)).status).toBe(429);
  });

  it("limits each customer separately", async () => {
    const other = await createCustomerWithAccount(0);
    for (let index = 0; index < LIMIT; index += 1) {
      await deposit(customer);
    }
    expect((await deposit(customer)).status).toBe(429);

    expect((await deposit(other)).status).toBe(201);
  });

  it("does not limit reading accounts and history", async () => {
    for (let index = 0; index <= LIMIT; index += 1) {
      await deposit(customer);
    }

    const accounts = await request(app).get("/api/v1/accounts").set("Cookie", customer.cookie);
    const history = await request(app).get("/api/v1/transactions").set("Cookie", customer.cookie);

    expect(accounts.status).toBe(200);
    expect(history.status).toBe(200);
  });

  it("does not count unauthenticated requests against anyone", async () => {
    for (let index = 0; index < LIMIT * 2; index += 1) {
      const res = await request(app)
        .post(`/api/v1/accounts/${customer.accountId}/deposits`)
        .set("Idempotency-Key", randomUUID())
        .send({ amount: 100 });
      expect(res.status).toBe(401);
    }

    expect((await deposit(customer)).status).toBe(201);
  });
});
