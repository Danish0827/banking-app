import { isTestDatabaseName } from "../../src/config/databaseName.js";
import { pool, type Queryable } from "../../src/db/pool.js";

/**
 * Asks the server which database this connection is really attached to and
 * refuses to continue unless it is a test database. Checking the live
 * connection (not the configured URL) means no misconfiguration can point a
 * destructive helper at development data.
 */
export async function assertTestDatabase(db: Queryable = pool): Promise<void> {
  const { rows } = await db.query<{ name: string }>("SELECT current_database() AS name");
  const name = rows[0]?.name ?? "";

  if (!isTestDatabaseName(name)) {
    throw new Error(
      `Refusing to modify database "${name}": test helpers only run against a database whose name ends in "_test"`,
    );
  }
}

/** Empties every application table. Only ever runs against a test database. */
export async function resetDatabase(db: Queryable = pool): Promise<void> {
  await assertTestDatabase(db);
  await db.query(
    "TRUNCATE TABLE ledger_entries, transactions, accounts, customers RESTART IDENTITY CASCADE",
  );
}
