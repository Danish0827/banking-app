import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../../src/db/pool.js";
import { resetDatabase } from "../../helpers/database.js";
import { createAccount, createCustomer } from "../../helpers/fixtures.js";

// PostgreSQL error codes
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const NOT_NULL_VIOLATION = "23502";
const RESTRICT_VIOLATION = "23001";

const UNKNOWN_ID = "00000000-0000-4000-8000-00000000dead";

function insertTransaction(values: {
  type: string;
  amount?: number;
  source?: string | null;
  destination?: string | null;
  initiatedBy: string;
  idempotencyKey?: string | null;
  description?: string | null;
}) {
  return pool.query<{ id: string }>(
    `INSERT INTO transactions
       (type, amount, source_account_id, destination_account_id, initiated_by, idempotency_key, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      values.type,
      values.amount ?? 1_000,
      values.source ?? null,
      values.destination ?? null,
      values.initiatedBy,
      values.idempotencyKey ?? null,
      values.description ?? null,
    ],
  );
}

function insertLedgerEntry(values: {
  transactionId: string;
  accountId: string;
  direction?: string;
  amount?: number;
  balanceAfter?: number;
}) {
  return pool.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, balance_after)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      values.transactionId,
      values.accountId,
      values.direction ?? "credit",
      values.amount ?? 1_000,
      values.balanceAfter ?? 1_000,
    ],
  );
}

describe("database schema", () => {
  let customerId: string;
  let accountId: string;
  let otherAccountId: string;

  beforeEach(async () => {
    await resetDatabase();
    customerId = await createCustomer();
    accountId = await createAccount(customerId);
    otherAccountId = await createAccount(customerId);
  });

  it("creates every table", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );

    expect(rows.map((row) => row.table_name)).toEqual([
      "accounts",
      "customers",
      "ledger_entries",
      "pgmigrations",
      "transactions",
    ]);
  });

  it("uses the intended column types for money, email and ids", async () => {
    const { rows } = await pool.query<{ column: string; type: string }>(
      `SELECT table_name || '.' || column_name AS column, udt_name AS type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name, column_name) IN (
           ('customers', 'email'), ('accounts', 'balance'), ('transactions', 'amount'),
           ('ledger_entries', 'amount'), ('ledger_entries', 'balance_after'),
           ('ledger_entries', 'id'), ('accounts', 'id'))
       ORDER BY 1`,
    );

    expect(Object.fromEntries(rows.map((row) => [row.column, row.type]))).toEqual({
      "accounts.balance": "int8",
      "accounts.id": "uuid",
      "customers.email": "citext",
      "ledger_entries.amount": "int8",
      "ledger_entries.balance_after": "int8",
      "ledger_entries.id": "int8",
      "transactions.amount": "int8",
    });
  });

  it("creates the supporting indexes", async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
    );

    expect(rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "accounts_customer_id_idx",
        "transactions_source_account_id_idx",
        "transactions_destination_account_id_idx",
        "ledger_entries_account_id_id_idx",
      ]),
    );
  });

  describe("customers", () => {
    it("treats email as case-insensitive for uniqueness and lookup", async () => {
      await createCustomer(pool, { email: "Alice@Example.com" });

      await expect(createCustomer(pool, { email: "alice@example.COM" })).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: "customers_email_key",
      });

      const { rows } = await pool.query("SELECT email FROM customers WHERE email = $1", [
        "ALICE@EXAMPLE.COM",
      ]);
      expect(rows).toEqual([{ email: "Alice@Example.com" }]);
    });

    it("rejects a malformed email", async () => {
      await expect(createCustomer(pool, { email: "not-an-email" })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: "customers_email_check",
      });
    });

    it("requires a password hash", async () => {
      await expect(
        pool.query("INSERT INTO customers (email, full_name) VALUES ('a@example.com', 'A')"),
      ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION, column: "password_hash" });
    });
  });

  describe("accounts", () => {
    it("defaults to a zero USD balance", async () => {
      const { rows } = await pool.query("SELECT balance, currency FROM accounts WHERE id = $1", [
        accountId,
      ]);

      expect(rows).toEqual([{ balance: 0, currency: "USD" }]);
    });

    it("rejects a negative balance on insert", async () => {
      await expect(createAccount(customerId, { balance: -1 })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: "accounts_balance_check",
      });
    });

    it("rejects an update that would overdraw the account", async () => {
      await pool.query("UPDATE accounts SET balance = 500 WHERE id = $1", [accountId]);

      await expect(
        pool.query("UPDATE accounts SET balance = balance - 501 WHERE id = $1", [accountId]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: "accounts_balance_check" });

      const { rows } = await pool.query("SELECT balance FROM accounts WHERE id = $1", [accountId]);
      expect(rows).toEqual([{ balance: 500 }]);
    });

    it("rejects a duplicate account number", async () => {
      await createAccount(customerId, { accountNumber: "1234567890" });

      await expect(
        createAccount(customerId, { accountNumber: "1234567890" }),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: "accounts_account_number_key",
      });
    });

    it.each(["12345", "12345678901", "12345abcde"])(
      "rejects the malformed account number %j",
      async (accountNumber) => {
        await expect(createAccount(customerId, { accountNumber })).rejects.toMatchObject({
          code: CHECK_VIOLATION,
          constraint: "accounts_account_number_check",
        });
      },
    );

    it("rejects an unknown account type", async () => {
      await expect(createAccount(customerId, { type: "brokerage" })).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: "accounts_type_check",
      });
    });

    it("rejects a currency other than USD", async () => {
      await expect(
        pool.query("UPDATE accounts SET currency = 'EUR' WHERE id = $1", [accountId]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: "accounts_currency_check" });
    });

    it("requires an existing customer", async () => {
      await expect(createAccount(UNKNOWN_ID)).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: "accounts_customer_id_fkey",
      });
    });

    it("does not allow a customer with accounts to be deleted", async () => {
      await expect(
        pool.query("DELETE FROM customers WHERE id = $1", [customerId]),
      ).rejects.toMatchObject({
        // ON DELETE RESTRICT is reported as 23001 from PostgreSQL 18, 23503 before.
        code: expect.stringMatching(/^(23001|23503)$/),
        constraint: "accounts_customer_id_fkey",
      });
    });

    it("maintains updated_at on update", async () => {
      const { rows } = await pool.query<{ touched: boolean }>(
        `UPDATE accounts SET balance = 100, updated_at = '2000-01-01' WHERE id = $1
         RETURNING updated_at > '2000-01-01' AS touched`,
        [accountId],
      );

      expect(rows[0]?.touched).toBe(true);
    });
  });

  describe("transactions", () => {
    it("accepts a well-formed deposit, withdrawal and transfer", async () => {
      await insertTransaction({ type: "deposit", destination: accountId, initiatedBy: customerId });
      await insertTransaction({ type: "withdrawal", source: accountId, initiatedBy: customerId });
      await insertTransaction({
        type: "transfer",
        source: accountId,
        destination: otherAccountId,
        initiatedBy: customerId,
      });

      const { rows } = await pool.query("SELECT count(*)::int AS count FROM transactions");
      expect(rows).toEqual([{ count: 3 }]);
    });

    it.each([0, -100])("rejects the non-positive amount %d", async (amount) => {
      await expect(
        insertTransaction({
          type: "deposit",
          amount,
          destination: accountId,
          initiatedBy: customerId,
        }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: "transactions_amount_check" });
    });

    it("rejects an unknown type", async () => {
      await expect(
        insertTransaction({ type: "refund", destination: accountId, initiatedBy: customerId }),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });

      const { rows } = await pool.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint WHERE conname = 'transactions_type_check'`,
      );
      expect(rows[0]?.definition).toMatch(/deposit.*withdrawal.*transfer/);
    });

    it.each([
      ["a deposit with a source account", { type: "deposit", source: true, destination: true }],
      ["a deposit without a destination", { type: "deposit", source: false, destination: false }],
      ["a withdrawal with a destination", { type: "withdrawal", source: true, destination: true }],
      ["a withdrawal without a source", { type: "withdrawal", source: false, destination: false }],
      ["a transfer without a destination", { type: "transfer", source: true, destination: false }],
      ["a transfer without a source", { type: "transfer", source: false, destination: true }],
    ])("rejects %s", async (_label, shape) => {
      await expect(
        insertTransaction({
          type: shape.type,
          source: shape.source ? accountId : null,
          destination: shape.destination ? otherAccountId : null,
          initiatedBy: customerId,
        }),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: "transactions_accounts_check",
      });
    });

    it("rejects a transfer from an account to itself", async () => {
      await expect(
        insertTransaction({
          type: "transfer",
          source: accountId,
          destination: accountId,
          initiatedBy: customerId,
        }),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: "transactions_accounts_check",
      });
    });

    it("requires existing accounts and an existing initiating customer", async () => {
      await expect(
        insertTransaction({ type: "deposit", destination: UNKNOWN_ID, initiatedBy: customerId }),
      ).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: "transactions_destination_account_id_fkey",
      });

      await expect(
        insertTransaction({ type: "deposit", destination: accountId, initiatedBy: UNKNOWN_ID }),
      ).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: "transactions_initiated_by_fkey",
      });
    });

    it("rejects a description longer than 140 characters", async () => {
      await expect(
        insertTransaction({
          type: "deposit",
          destination: accountId,
          initiatedBy: customerId,
          description: "x".repeat(141),
        }),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: "transactions_description_check",
      });
    });

    describe("idempotency key", () => {
      const deposit = (initiatedBy: string, idempotencyKey: string | null) =>
        insertTransaction({ type: "deposit", destination: accountId, initiatedBy, idempotencyKey });

      it("cannot be reused by the same customer", async () => {
        await deposit(customerId, "key-1");

        await expect(deposit(customerId, "key-1")).rejects.toMatchObject({
          code: UNIQUE_VIOLATION,
          constraint: "transactions_initiated_by_idempotency_key_key",
        });
      });

      it("can be used by different customers, and omitted any number of times", async () => {
        const otherCustomerId = await createCustomer();

        await deposit(customerId, "key-1");
        await deposit(otherCustomerId, "key-1");
        await deposit(customerId, null);
        await deposit(customerId, null);

        const { rows } = await pool.query("SELECT count(*)::int AS count FROM transactions");
        expect(rows).toEqual([{ count: 4 }]);
      });
    });

    it("is immutable: rows cannot be updated or deleted", async () => {
      const { rows } = await insertTransaction({
        type: "deposit",
        destination: accountId,
        initiatedBy: customerId,
      });
      const id = rows[0]?.id;

      await expect(
        pool.query("UPDATE transactions SET amount = 1 WHERE id = $1", [id]),
      ).rejects.toMatchObject({ code: RESTRICT_VIOLATION });
      await expect(
        pool.query("DELETE FROM transactions WHERE id = $1", [id]),
      ).rejects.toMatchObject({ code: RESTRICT_VIOLATION });

      const after = await pool.query("SELECT amount FROM transactions WHERE id = $1", [id]);
      expect(after.rows).toEqual([{ amount: 1_000 }]);
    });
  });

  describe("ledger_entries", () => {
    let transactionId: string;

    beforeEach(async () => {
      const { rows } = await insertTransaction({
        type: "deposit",
        destination: accountId,
        initiatedBy: customerId,
      });
      transactionId = (rows[0] as { id: string }).id;
    });

    it("assigns increasing numeric ids", async () => {
      await insertLedgerEntry({ transactionId, accountId });
      await insertLedgerEntry({ transactionId, accountId: otherAccountId });

      const { rows } = await pool.query("SELECT id FROM ledger_entries ORDER BY id");
      expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("rejects an unknown direction", async () => {
      await expect(
        insertLedgerEntry({ transactionId, accountId, direction: "sideways" }),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: "ledger_entries_direction_check",
      });
    });

    it("rejects a non-positive amount and a negative resulting balance", async () => {
      await expect(
        insertLedgerEntry({ transactionId, accountId, amount: 0 }),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: "ledger_entries_amount_check",
      });

      await expect(
        insertLedgerEntry({ transactionId, accountId, balanceAfter: -1 }),
      ).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: "ledger_entries_balance_after_check",
      });
    });

    it("allows one entry per account within a transaction", async () => {
      await insertLedgerEntry({ transactionId, accountId });

      await expect(insertLedgerEntry({ transactionId, accountId })).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: "ledger_entries_transaction_id_account_id_key",
      });
    });

    it("requires an existing transaction and account", async () => {
      await expect(
        insertLedgerEntry({ transactionId: UNKNOWN_ID, accountId }),
      ).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: "ledger_entries_transaction_id_fkey",
      });

      await expect(
        insertLedgerEntry({ transactionId, accountId: UNKNOWN_ID }),
      ).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: "ledger_entries_account_id_fkey",
      });
    });

    it("is immutable: rows cannot be updated or deleted", async () => {
      await insertLedgerEntry({ transactionId, accountId });

      await expect(pool.query("UPDATE ledger_entries SET amount = 1")).rejects.toMatchObject({
        code: RESTRICT_VIOLATION,
      });
      await expect(pool.query("DELETE FROM ledger_entries")).rejects.toMatchObject({
        code: RESTRICT_VIOLATION,
      });

      const { rows } = await pool.query("SELECT amount FROM ledger_entries");
      expect(rows).toEqual([{ amount: 1_000 }]);
    });
  });
});
