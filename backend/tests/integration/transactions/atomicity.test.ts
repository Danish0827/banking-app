import type { Express } from "express";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { assertTestDatabase, resetDatabase } from "../../helpers/database.js";
import {
  balanceOf,
  countRows,
  createCustomerWithAccount,
  expectLedgerConsistent,
  postMovement,
  type Operation,
  type TestCustomer,
} from "../../helpers/money.js";

// Any movement of exactly this amount fails at the injected point.
const FAILING_AMOUNT = 4242;

/**
 * Makes inserts into `table` fail for one specific amount, using a trigger in
 * the test database. The failure happens inside the real code path, after the
 * earlier steps of the money movement have already run in the transaction:
 *
 *   UPDATE accounts -> INSERT transactions -> INSERT ledger_entries
 */
async function injectFailureOnInsertInto(table: "transactions" | "ledger_entries") {
  await assertTestDatabase();
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_injected_failure() RETURNS trigger AS $$
    BEGIN
      IF NEW.amount = ${FAILING_AMOUNT} THEN
        RAISE EXCEPTION 'injected failure for atomicity test';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`);
  await pool.query(`
    CREATE TRIGGER test_injected_failure
      BEFORE INSERT ON ${table}
      FOR EACH ROW EXECUTE FUNCTION test_injected_failure()`);
}

async function removeInjectedFailure() {
  await pool.query("DROP TRIGGER IF EXISTS test_injected_failure ON transactions");
  await pool.query("DROP TRIGGER IF EXISTS test_injected_failure ON ledger_entries");
  await pool.query("DROP FUNCTION IF EXISTS test_injected_failure()");
}

describe("atomicity of deposits and withdrawals", () => {
  let app: Express;
  let customer: TestCustomer;

  beforeAll(async () => {
    await resetDatabase();
    app = createApp();
  });

  beforeEach(async () => {
    customer = await createCustomerWithAccount(10_000);
  });

  afterEach(removeInjectedFailure);

  describe.each([
    ["recording the transaction", "transactions"],
    ["recording the ledger entry", "ledger_entries"],
  ] as const)("when %s fails", (_label, table) => {
    it.each(["deposits", "withdrawals"] as Operation[])(
      "rolls back the whole %s",
      async (operation) => {
        await injectFailureOnInsertInto(table);
        const transactionsBefore = await countRows("transactions");
        const entriesBefore = await countRows("ledger_entries");

        const res = await postMovement(
          app,
          operation,
          customer.accountId,
          {
            amount: FAILING_AMOUNT,
          },
          { cookie: customer.cookie },
        );

        // The client gets a generic error, not the database's message.
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe("INTERNAL_ERROR");
        expect(res.text).not.toContain("injected failure");

        // No partial account update, transaction or ledger entry survives.
        expect(await balanceOf(customer.accountId)).toBe(10_000);
        expect(await countRows("transactions")).toBe(transactionsBefore);
        expect(await countRows("ledger_entries")).toBe(entriesBefore);
        await expectLedgerConsistent(customer.accountId);
      },
    );
  });

  it("does not consume the idempotency key of a failed request", async () => {
    await injectFailureOnInsertInto("ledger_entries");
    const options = { cookie: customer.cookie, idempotencyKey: "retry-after-failure" };

    const failed = await postMovement(
      app,
      "deposits",
      customer.accountId,
      {
        amount: FAILING_AMOUNT,
      },
      options,
    );
    expect(failed.status).toBe(500);

    await removeInjectedFailure();
    const retried = await postMovement(
      app,
      "deposits",
      customer.accountId,
      {
        amount: FAILING_AMOUNT,
      },
      options,
    );

    expect(retried.status).toBe(201);
    expect(retried.headers["idempotent-replayed"]).toBeUndefined();
    expect(await balanceOf(customer.accountId)).toBe(10_000 + FAILING_AMOUNT);
    await expectLedgerConsistent(customer.accountId);
  });

  it("releases the account lock after a rollback", async () => {
    await injectFailureOnInsertInto("ledger_entries");
    await postMovement(
      app,
      "withdrawals",
      customer.accountId,
      { amount: FAILING_AMOUNT },
      {
        cookie: customer.cookie,
      },
    );
    await removeInjectedFailure();

    // Would wait for the statement timeout if the row were still locked.
    const res = await postMovement(
      app,
      "withdrawals",
      customer.accountId,
      { amount: 100 },
      {
        cookie: customer.cookie,
      },
    );

    expect(res.status).toBe(201);
    expect(await balanceOf(customer.accountId)).toBe(9_900);
  });
});
