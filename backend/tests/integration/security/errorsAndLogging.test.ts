import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { pino } from "pino";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { resetDatabase } from "../../helpers/database.js";
import { addAccount, createCustomerWithAccount, type TestCustomer } from "../../helpers/money.js";

/** An app whose log output is captured in memory, at the most verbose level. */
function appWithCapturedLogs() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return {
    app: createApp({ logger: pino({ level: "trace" }, destination) }),
    output: () => lines.join(""),
  };
}

/**
 * What a database failure can carry: a message naming the server and user, a
 * row with a balance and an account number, a file path and a stack.
 */
function databaseFailure() {
  return Object.assign(
    new Error(
      'connect ECONNREFUSED 10.20.30.40:5432 password authentication failed for user "bank" at /srv/bank/src/db/pool.ts',
    ),
    {
      code: "23514",
      constraint: "accounts_balance_check",
      table: "accounts",
      detail: "Failing row contains (acct, cust, 1000000001, checking, USD, 987654321).",
      where: 'SQL statement "UPDATE accounts SET balance = 987654321"',
    },
  );
}

/** Makes queries that read the accounts table fail; everything else runs normally. */
function failAccountQueries() {
  const query = pool.query.bind(pool);
  vi.spyOn(pool, "query").mockImplementation(((sql: unknown, params?: unknown) => {
    if (typeof sql === "string" && sql.includes("FROM accounts")) {
      return Promise.reject(databaseFailure());
    }
    return query(sql as string, params as unknown[]);
  }) as typeof pool.query);
}

describe("errors and logging", () => {
  let customer: TestCustomer;

  beforeAll(async () => {
    await resetDatabase();
    customer = await createCustomerWithAccount(10_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("unexpected errors", () => {
    it("become a generic 500 with no internals", async () => {
      failAccountQueries();
      const { app } = appWithCapturedLogs();

      const res = await request(app).get("/api/v1/accounts").set("Cookie", customer.cookie);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
          requestId: expect.any(String),
        },
      });
      for (const secret of [
        "ECONNREFUSED",
        "10.20.30.40",
        "password",
        "/srv/bank",
        "pool.ts",
        "23514",
        "accounts_balance_check",
        "987654321",
        "1000000001",
        "UPDATE",
        "stack",
      ]) {
        expect(res.text).not.toContain(secret);
      }
    });

    it("carry a request id that matches the log line", async () => {
      failAccountQueries();
      const { app, output } = appWithCapturedLogs();

      const res = await request(app)
        .get("/api/v1/accounts")
        .set("Cookie", customer.cookie)
        .set("X-Request-Id", "trace-me-123");

      expect(res.body.error.requestId).toBe("trace-me-123");
      expect(output()).toContain('"id":"trace-me-123"');
      expect(output()).toContain("Unhandled error");
    });

    it("are logged without the database row, balances or account numbers", async () => {
      failAccountQueries();
      const { app, output } = appWithCapturedLogs();

      await request(app).get("/api/v1/accounts").set("Cookie", customer.cookie);

      const logged = output();
      // Enough to diagnose: the error code, constraint and table.
      expect(logged).toContain('"code":"23514"');
      expect(logged).toContain('"constraint":"accounts_balance_check"');
      // Not the row data the database attached to the error.
      expect(logged).not.toContain("Failing row");
      expect(logged).not.toContain("987654321");
      expect(logged).not.toContain("1000000001");
    });
  });

  describe("request logs for money movements", () => {
    it("contain no amounts, balances, account numbers, keys or cookies", async () => {
      const { app, output } = appWithCapturedLogs();
      const savings = await addAccount(customer.customerId, 0);
      const { rows } = await pool.query<{ account_number: string }>(
        "SELECT account_number FROM accounts WHERE id = $1",
        [customer.accountId],
      );
      const key = `secret-key-${randomUUID()}`;

      const depositRes = await request(app)
        .post(`/api/v1/accounts/${customer.accountId}/deposits`)
        .set("Cookie", customer.cookie)
        .set("Idempotency-Key", key)
        .send({ amount: 987_654 });
      await request(app)
        .post(`/api/v1/accounts/${customer.accountId}/transfers`)
        .set("Cookie", customer.cookie)
        .set("Idempotency-Key", `${key}-transfer`)
        .send({ destinationAccountId: savings, amount: 123_457 });
      await request(app).get("/api/v1/transactions").set("Cookie", customer.cookie);

      const logged = output();
      expect(depositRes.status).toBe(201);
      for (const secret of [
        key,
        "987654",
        "123457",
        String(depositRes.body.data.account.balance),
        rows[0]?.account_number as string,
        customer.cookie.split("=")[1] as string,
      ]) {
        expect(logged).not.toContain(secret);
      }
      expect(logged).not.toMatch(/idempotency|cookie|authorization|amount|balance/i);
    });
  });
});
