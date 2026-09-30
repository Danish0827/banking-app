import bcrypt from "bcrypt";
import { beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../../src/db/pool.js";
import { seedDatabase } from "../../../src/db/seed/seed.js";
import { DEMO_PASSWORD, SEED_CUSTOMERS } from "../../../src/db/seed/seedData.js";
import { resetDatabase } from "../../helpers/database.js";

// The minimum bcrypt cost keeps the suite fast; the real seed uses the default.
const seed = () => seedDatabase({ bcryptRounds: 4 });

const EXPECTED_ACCOUNTS = SEED_CUSTOMERS.flatMap((customer) =>
  customer.accounts.map((account) => ({
    account_number: account.accountNumber,
    email: customer.email,
    type: account.type,
    currency: "USD",
    balance: account.openingBalance,
  })),
);

async function tableCounts() {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM customers)      AS customers,
            (SELECT count(*)::int FROM accounts)       AS accounts,
            (SELECT count(*)::int FROM transactions)   AS transactions,
            (SELECT count(*)::int FROM ledger_entries) AS ledger_entries`,
  );
  return rows[0];
}

describe("seedDatabase", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("inserts the demo customers and accounts", async () => {
    const result = await seed();

    expect(result).toEqual({ customersCreated: 3, accountsCreated: 5 });

    const { rows } = await pool.query(
      `SELECT a.account_number, c.email, a.type, a.currency, a.balance
       FROM accounts a JOIN customers c ON c.id = a.customer_id
       ORDER BY a.account_number`,
    );
    expect(rows).toEqual(EXPECTED_ACCOUNTS);
  });

  it("stores bcrypt hashes, never the plaintext password", async () => {
    await seed();

    const { rows } = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM customers",
    );

    expect(rows).toHaveLength(3);
    for (const { password_hash } of rows) {
      expect(password_hash).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
      expect(password_hash).not.toContain(DEMO_PASSWORD);
      expect(await bcrypt.compare(DEMO_PASSWORD, password_hash)).toBe(true);
      expect(await bcrypt.compare("wrong-password", password_hash)).toBe(false);
    }

    // Each customer gets an individually salted hash.
    expect(new Set(rows.map((row) => row.password_hash)).size).toBe(3);
  });

  it("records every opening balance in the ledger", async () => {
    await seed();

    // Four accounts open with money; the zero-balance account has no entry.
    expect(await tableCounts()).toEqual({
      customers: 3,
      accounts: 5,
      transactions: 4,
      ledger_entries: 4,
    });

    const { rows } = await pool.query(
      `SELECT a.account_number
       FROM accounts a
       LEFT JOIN ledger_entries e ON e.account_id = a.id
       GROUP BY a.id
       HAVING a.balance <> COALESCE(
         SUM(CASE e.direction WHEN 'credit' THEN e.amount ELSE -e.amount END), 0)`,
    );
    expect(rows).toEqual([]);
  });

  it("uses the same ids on every run", async () => {
    await seed();

    const { rows } = await pool.query<{ id: string }>("SELECT id FROM customers ORDER BY id");
    expect(rows.map((row) => row.id)).toEqual(SEED_CUSTOMERS.map((customer) => customer.id));
  });

  it("is safe to run again: nothing is duplicated or overwritten", async () => {
    await seed();
    const account = SEED_CUSTOMERS[0]?.accounts[0];
    await pool.query("UPDATE accounts SET balance = 1 WHERE id = $1", [account?.id]);
    const hashesBefore = await pool.query("SELECT id, password_hash FROM customers ORDER BY id");

    const secondRun = await seed();

    expect(secondRun).toEqual({ customersCreated: 0, accountsCreated: 0 });
    expect(await tableCounts()).toEqual({
      customers: 3,
      accounts: 5,
      transactions: 4,
      ledger_entries: 4,
    });

    const balance = await pool.query("SELECT balance FROM accounts WHERE id = $1", [account?.id]);
    expect(balance.rows).toEqual([{ balance: 1 }]);

    const hashesAfter = await pool.query("SELECT id, password_hash FROM customers ORDER BY id");
    expect(hashesAfter.rows).toEqual(hashesBefore.rows);
  });
});
