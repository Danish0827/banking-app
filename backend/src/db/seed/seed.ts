import type pg from "pg";
import { BCRYPT_ROUNDS, hashPassword } from "../../lib/password.js";
import { pool } from "../pool.js";
import { withTransaction } from "../transaction.js";
import { DEMO_PASSWORD, SEED_CUSTOMERS, type SeedAccount, type SeedCustomer } from "./seedData.js";

export interface SeedOptions {
  db?: pg.Pool;
  /** bcrypt cost factor. Tests lower it to keep the suite fast. */
  bcryptRounds?: number;
}

export interface SeedResult {
  customersCreated: number;
  accountsCreated: number;
}

/**
 * Inserts the demo customers and accounts.
 *
 * Safe to run repeatedly: rows are matched on their fixed ids and anything
 * that already exists is left untouched, so existing balances and history are
 * never overwritten or deleted. Everything runs in one transaction; a failure
 * leaves the database as it was.
 */
export async function seedDatabase({
  db = pool,
  bcryptRounds = BCRYPT_ROUNDS,
}: SeedOptions = {}): Promise<SeedResult> {
  // Hashing is slow by design, so do it before opening the transaction.
  const passwordHashes = await Promise.all(
    SEED_CUSTOMERS.map(() => hashPassword(DEMO_PASSWORD, bcryptRounds)),
  );

  return withTransaction(async (client) => {
    const result: SeedResult = { customersCreated: 0, accountsCreated: 0 };

    for (const [index, customer] of SEED_CUSTOMERS.entries()) {
      const created = await insertCustomer(client, customer, passwordHashes[index] as string);
      if (created) result.customersCreated += 1;

      for (const account of customer.accounts) {
        const accountCreated = await insertAccount(client, customer, account);
        if (accountCreated) result.accountsCreated += 1;
      }
    }

    return result;
  }, db);
}

async function insertCustomer(
  client: pg.PoolClient,
  customer: SeedCustomer,
  passwordHash: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `INSERT INTO customers (id, email, full_name, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [customer.id, customer.email, customer.fullName, passwordHash],
  );
  return rowCount === 1;
}

/**
 * Creates the account and, when it has an opening balance, records that
 * balance as a deposit so the ledger explains every cent from the start.
 */
async function insertAccount(
  client: pg.PoolClient,
  customer: SeedCustomer,
  account: SeedAccount,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `INSERT INTO accounts (id, customer_id, account_number, type, balance)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [account.id, customer.id, account.accountNumber, account.type, account.openingBalance],
  );
  if (rowCount !== 1) return false;
  if (account.openingBalance === 0) return true;

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (type, amount, destination_account_id, description, initiated_by)
     VALUES ('deposit', $1, $2, 'Opening deposit', $3)
     RETURNING id`,
    [account.openingBalance, account.id, customer.id],
  );
  const transactionId = (rows[0] as { id: string }).id;

  await client.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, balance_after)
     VALUES ($1, $2, 'credit', $3, $3)`,
    [transactionId, account.id, account.openingBalance],
  );

  return true;
}
