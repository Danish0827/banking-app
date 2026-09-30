import type pg from "pg";
import { logger } from "../config/logger.js";
import { pool } from "./pool.js";

/**
 * Runs `fn` inside a single PostgreSQL transaction.
 *
 * One client is checked out of the pool and handed to `fn`; every statement of
 * the transaction must go through that client, never through the pool, because
 * the pool would run it on a different connection outside the transaction.
 *
 * - `fn` resolves: the transaction is committed and its result returned.
 * - `fn` (or COMMIT) throws: the transaction is rolled back and the original
 *   error is rethrown.
 * - The client is always released. If ROLLBACK itself fails the connection is
 *   in an unknown state, so it is destroyed instead of returned to the pool.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  db: pg.Pool = pool,
): Promise<T> {
  const client = await db.connect();
  let connectionBroken = false;

  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      connectionBroken = true;
      logger.error({ err: rollbackErr }, "Failed to roll back transaction");
    }
    throw err;
  } finally {
    client.release(connectionBroken);
  }
}
