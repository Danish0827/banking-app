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

/**
 * A connection pool configured from the environment (DB_POOL_MAX,
 * DB_CONNECTION_TIMEOUT_MS, DB_IDLE_TIMEOUT_MS, DB_STATEMENT_TIMEOUT_MS):
 *
 * - at most `max` connections; when all are busy, a request waits up to the
 *   connection timeout for one and then fails, rather than queueing forever;
 * - idle connections are closed after the idle timeout;
 * - no statement, and no transaction left idle while holding row locks, can
 *   run longer than the statement timeout.
 */
export function createPool(connectionString: string, max: number = env.DB_POOL_MAX): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    application_name: "banking-app",
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: env.DB_STATEMENT_TIMEOUT_MS,
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
