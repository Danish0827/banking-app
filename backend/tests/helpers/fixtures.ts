import { pool, type Queryable } from "../../src/db/pool.js";

let sequence = 0;

/** Inserts a customer with a unique email and returns its id. */
export async function createCustomer(
  db: Queryable = pool,
  overrides: { email?: string } = {},
): Promise<string> {
  sequence += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO customers (email, full_name, password_hash)
     VALUES ($1, 'Test Customer', 'not-a-real-hash')
     RETURNING id`,
    [overrides.email ?? `customer-${sequence}-${Date.now()}@example.com`],
  );
  return (rows[0] as { id: string }).id;
}

/** Inserts an account with a unique 10-digit number and returns its id. */
export async function createAccount(
  customerId: string,
  overrides: { balance?: number; accountNumber?: string; type?: string } = {},
  db: Queryable = pool,
): Promise<string> {
  sequence += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO accounts (customer_id, account_number, type, balance)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      customerId,
      overrides.accountNumber ?? String(9_000_000_000 + sequence),
      overrides.type ?? "checking",
      overrides.balance ?? 0,
    ],
  );
  return (rows[0] as { id: string }).id;
}
