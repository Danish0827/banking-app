import type { RequestHandler } from "express";
import { ServiceUnavailableError } from "../../errors/AppError.js";

/**
 * Liveness: the process is up and serving HTTP. Deliberately touches nothing
 * else, so it stays cheap and a database outage never makes the process
 * look dead (which would get it restarted for no reason).
 */
export const getHealth: RequestHandler = (_req, res) => {
  res.status(200).json({ data: { status: "ok" } });
};

export interface ReadinessOptions {
  /** Resolves if the database answers; rejects otherwise. */
  checkDatabase: () => Promise<void>;
  /** Upper bound for the check, so a hung database can't hang the probe. */
  timeoutMs: number;
  isShuttingDown: () => boolean;
}

function withTimeout(check: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Readiness check timed out")), timeoutMs);
  });
  return Promise.race([check, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Readiness: the process can serve real requests, i.e. PostgreSQL answers a
 * trivial query within the timeout and shutdown has not begun. Otherwise 503
 * with the standard error shape. The response says which check failed, never
 * why: no host, user, connection string or database error reaches the client.
 */
export function createReadinessHandler({
  checkDatabase,
  timeoutMs,
  isShuttingDown,
}: ReadinessOptions): RequestHandler {
  return async (req, res) => {
    if (isShuttingDown()) {
      throw new ServiceUnavailableError({ status: "shutting_down" });
    }

    try {
      await withTimeout(checkDatabase(), timeoutMs);
    } catch (err) {
      req.log.warn({ err }, "Readiness check failed: database unavailable");
      throw new ServiceUnavailableError({ checks: { database: "unavailable" } });
    }

    res.status(200).json({ data: { status: "ready", checks: { database: "ok" } } });
  };
}
