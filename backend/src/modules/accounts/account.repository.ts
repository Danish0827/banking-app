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
