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
  postTransfer,
  type TestCustomer,
} from "../../helpers/money.js";

/**
 * Failure points inside a transfer, in the order the transfer reaches them:
 *
 *   UPDATE source -> UPDATE destination -> INSERT transactions
 *     -> INSERT ledger (debit) -> INSERT ledger (credit) -> COMMIT
 *
 * Each is injected with a trigger in the test database that raises an error
 * at that exact point, so the real code path runs up to it.
 */
const FAILURE_POINTS = {
  "updating the destination balance": (destinationId: string) => `
    CREATE TRIGGER test_injected_failure BEFORE UPDATE ON accounts
    FOR EACH ROW WHEN (NEW.id = '${destinationId}')
    EXECUTE FUNCTION test_injected_failure()`,
  "recording the transaction": () => `
    CREATE TRIGGER test_injected_failure BEFORE INSERT ON transactions
    FOR EACH ROW WHEN (NEW.type = 'transfer')
    EXECUTE FUNCTION test_injected_failure()`,
  "recording the debit entry": () => `
    CREATE TRIGGER test_injected_failure BEFORE INSERT ON ledger_entries
    FOR EACH ROW WHEN (NEW.direction = 'debit')
    EXECUTE FUNCTION test_injected_failure()`,
  "recording the credit entry, after the debit entry": () => `
    CREATE TRIGGER test_injected_failure BEFORE INSERT ON ledger_entries
    FOR EACH ROW WHEN (NEW.direction = 'credit')
    EXECUTE FUNCTION test_injected_failure()`,
} as const;

async function injectFailure(createTrigger: string) {
  await assertTestDatabase();
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_injected_failure() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected failure for transfer atomicity test';
    END;
    $$ LANGUAGE plpgsql`);
  await pool.query(createTrigger);
}

async function removeInjectedFailure() {
  for (const table of ["accounts", "transactions", "ledger_entries"]) {
    await pool.query(`DROP TRIGGER IF EXISTS test_injected_failure ON ${table}`);
  }
  await pool.query("DROP FUNCTION IF EXISTS test_injected_failure()");
}

describe("atomicity of transfers", () => {
  let app: Express;
  let sender: TestCustomer;
  let recipient: TestCustomer;

  beforeAll(async () => {
    await resetDatabase();
    app = createApp();
  });

  beforeEach(async () => {
    // Set up before any trigger exists, through the real deposit path.
    sender = await createCustomerWithAccount(10_000);
    recipient = await createCustomerWithAccount(3_000);
  });

  afterEach(removeInjectedFailure);

  it.each(Object.entries(FAILURE_POINTS))(
    "rolls back the whole transfer when %s fails",
    async (_label, createTrigger) => {
      await injectFailure(createTrigger(recipient.accountId));
      const transactionsBefore = await countRows("transactions");
      const entriesBefore = await countRows("ledger_entries");

      const res = await postTransfer(app, sender.accountId, recipient.accountId, 2_500, {
        cookie: sender.cookie,
      });

      // A generic error; the database's message is not exposed.
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
      expect(res.text).not.toContain("injected failure");

      // Neither balance moved, and no transaction or ledger entry survived.
      expect(await balanceOf(sender.accountId)).toBe(10_000);
      expect(await balanceOf(recipient.accountId)).toBe(3_000);
      expect(await countRows("transactions")).toBe(transactionsBefore);
      expect(await countRows("ledger_entries")).toBe(entriesBefore);
      await expectLedgerConsistent(sender.accountId);
      await expectLedgerConsistent(recipient.accountId);
    },
  );

  it("does not consume the idempotency key of a rolled-back transfer", async () => {
    await injectFailure(FAILURE_POINTS["recording the credit entry, after the debit entry"]());
    const options = { cookie: sender.cookie, idempotencyKey: "transfer-retry-after-failure" };

    const failed = await postTransfer(app, sender.accountId, recipient.accountId, 2_500, options);
    expect(failed.status).toBe(500);

    await removeInjectedFailure();
    const retried = await postTransfer(app, sender.accountId, recipient.accountId, 2_500, options);

    expect(retried.status).toBe(201);
    expect(retried.headers["idempotent-replayed"]).toBeUndefined();
    expect(await balanceOf(sender.accountId)).toBe(7_500);
    expect(await balanceOf(recipient.accountId)).toBe(5_500);
    await expectLedgerConsistent(sender.accountId);
    await expectLedgerConsistent(recipient.accountId);
  });

  it("releases both row locks after a rollback", async () => {
    await injectFailure(FAILURE_POINTS["recording the transaction"]());
    await postTransfer(app, sender.accountId, recipient.accountId, 2_500, {
      cookie: sender.cookie,
    });
    await removeInjectedFailure();

    // Each would wait for the statement timeout if a row were still locked.
    const forward = await postTransfer(app, sender.accountId, recipient.accountId, 100, {
      cookie: sender.cookie,
    });
    const back = await postTransfer(app, recipient.accountId, sender.accountId, 100, {
      cookie: recipient.cookie,
    });

    expect(forward.status).toBe(201);
    expect(back.status).toBe(201);
  });
});
