import type { Queryable } from "../../db/pool.js";
import type { Customer, CustomerWithPasswordHash } from "./customer.types.js";

/**
 * Looks a customer up for authentication. This is the only query that reads
 * `password_hash`. Email is CITEXT, so the match is case-insensitive.
 */
export async function findCustomerByEmailForLogin(
  db: Queryable,
  email: string,
): Promise<CustomerWithPasswordHash | null> {
  const { rows } = await db.query<CustomerWithPasswordHash>(
    `SELECT id, email, full_name AS "fullName", password_hash AS "passwordHash"
     FROM customers
     WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function customerExists(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query("SELECT 1 FROM customers WHERE id = $1", [id]);
  return rowCount === 1;
}

export async function findCustomerById(db: Queryable, id: string): Promise<Customer | null> {
  const { rows } = await db.query<Customer>(
    `SELECT id, email, full_name AS "fullName"
     FROM customers
     WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
