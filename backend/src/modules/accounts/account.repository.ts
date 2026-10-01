import type { Queryable } from "../../db/pool.js";
import type { Account } from "./account.types.js";

// Only the columns the API exposes. `customer_id` is used for filtering and is
// never selected, so it cannot leak into a response.
const ACCOUNT_COLUMNS = `
  id,
  account_number AS "accountNumber",
  type,
  currency,
  balance,
  created_at AS "createdAt"`;

export async function findAccountsByCustomerId(
  db: Queryable,
  customerId: string,
): Promise<Account[]> {
  const { rows } = await db.query<Account>(
    `SELECT ${ACCOUNT_COLUMNS}
     FROM accounts
     WHERE customer_id = $1
     ORDER BY account_number`,
    [customerId],
  );
  return rows;
}

/**
 * Finds an account only if it belongs to the given customer. Ownership is part
 * of the query itself, so an account owned by someone else is indistinguishable
 * from one that does not exist and can never be loaded by mistake.
 */
export async function findAccountByIdForCustomer(
  db: Queryable,
  accountId: string,
  customerId: string,
): Promise<Account | null> {
  const { rows } = await db.query<Account>(
    `SELECT ${ACCOUNT_COLUMNS}
     FROM accounts
     WHERE id = $1 AND customer_id = $2`,
    [accountId, customerId],
  );
  return rows[0] ?? null;
}

/**
 * Like `findAccountByIdForCustomer`, but also locks the account row until the
 * current database transaction ends. Concurrent money movements on the same
 * account wait here until the lock holder commits or rolls back, then read the
 * committed balance. Must be called on the transaction's client.
 */
export async function lockAccountForCustomer(
  client: Queryable,
  accountId: string,
  customerId: string,
): Promise<Account | null> {
  const { rows } = await client.query<Account>(
    `SELECT ${ACCOUNT_COLUMNS}
     FROM accounts
     WHERE id = $1 AND customer_id = $2
     FOR UPDATE`,
    [accountId, customerId],
  );
  return rows[0] ?? null;
}

/** Sets an account's balance. Call only while holding the row lock. */
export async function updateAccountBalance(
  client: Queryable,
  accountId: string,
  balance: number,
): Promise<void> {
  await client.query("UPDATE accounts SET balance = $2 WHERE id = $1", [accountId, balance]);
}

/**
 * Locks any account by id, whoever owns it, and reports its owner separately
 * so the caller decides what may be exposed. Used for a transfer's
 * destination, which may belong to another customer. Must be called on the
 * transaction's client.
 */
export async function lockAccountById(
  client: Queryable,
  accountId: string,
): Promise<{ account: Account; customerId: string } | null> {
  const { rows } = await client.query<Account & { customerId: string }>(
    `SELECT ${ACCOUNT_COLUMNS}, customer_id AS "customerId"
     FROM accounts
     WHERE id = $1
     FOR UPDATE`,
    [accountId],
  );
  const row = rows[0];
  if (!row) return null;

  const { customerId, ...account } = row;
  return { account, customerId };
}
