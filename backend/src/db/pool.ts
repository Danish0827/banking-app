import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { parseInt8 } from "./int8.js";

// BIGINT columns (balances, amounts, ledger ids) are returned as numbers, with
// a guard against precision loss. Note that SUM() over BIGINT yields NUMERIC,
// which stays a string unless the query casts it back with `::bigint`.
pg.types.setTypeParser(pg.types.builtins.INT8, parseInt8);

/**
 * Anything that can run a query: the shared pool, or the single client that
 * owns an open transaction. Repositories accept this so the same SQL can run
 * either standalone or as part of a transaction.
 */
export type Queryable = Pick<pg.PoolClient, "query">;

export function createPool(connectionString: string, max: number = env.DB_POOL_MAX): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    application_name: "banking-app",
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // Bound how long a query or an abandoned transaction can hold row locks.
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 10_000,
  });

  // Errors on idle clients (e.g. the server restarting) are emitted on the
  // pool; without a listener they would crash the process.
  pool.on("error", (err) => {
    logger.error({ err }, "Unexpected error on idle PostgreSQL client");
  });

  return pool;
}

/** The single connection pool shared by the application. */
export const pool = createPool(env.DATABASE_URL);

/** Verifies the database is reachable; used to fail fast at startup. */
export async function checkDatabaseConnection(db: Queryable = pool): Promise<void> {
  await db.query("SELECT 1");
}
