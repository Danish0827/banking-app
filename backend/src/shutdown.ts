import type { Server } from "node:http";
import type { Logger } from "pino";

export interface ShutdownOptions {
  server: Pick<Server, "close" | "closeAllConnections">;
  /** Closes the database pool. Runs only after the HTTP server has stopped. */
  closeDatabase: () => Promise<void>;
  logger: Pick<Logger, "info" | "warn" | "error">;
  /** How long in-flight requests get before remaining connections are cut. */
  timeoutMs: number;
  exit: (code: number) => void;
  /** Called first, e.g. to make the readiness check report "not ready". */
  onShutdownStart?: () => void;
}

/**
 * Returns the SIGTERM/SIGINT handler. On the first signal it:
 *
 *   1. marks the service as shutting down (readiness turns 503);
 *   2. stops accepting connections and closes idle keep-alive ones, while
 *      in-flight requests run to completion;
 *   3. once the last request has finished, closes the database pool;
 *   4. exits with 0, or 1 if anything failed.
 *
 * If requests are still running after `timeoutMs`, the remaining connections
 * are closed and the process exits with 1, so shutdown can never hang.
 * Further signals while shutting down are logged and ignored.
 */
export function createShutdownHandler({
  server,
  closeDatabase,
  logger,
  timeoutMs,
  exit,
  onShutdownStart,
}: ShutdownOptions): (signal: string) => void {
  let started = false;

  return (signal) => {
    if (started) {
      logger.warn({ signal }, "Shutdown already in progress");
      return;
    }
    started = true;
    onShutdownStart?.();
    logger.info({ signal, timeoutMs }, "Shutting down: waiting for in-flight requests");

    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs }, "Shutdown timed out: closing remaining connections");
      server.closeAllConnections();
      exit(1);
    }, timeoutMs);
    // The timer must not by itself keep an otherwise idle process alive.
    forceExit.unref();

    server.close((serverErr) => {
      if (serverErr) {
        logger.error({ err: serverErr }, "Error while closing HTTP server");
      }

      closeDatabase()
        .then(() => {
          clearTimeout(forceExit);
          logger.info("Shutdown complete");
          exit(serverErr ? 1 : 0);
        })
        .catch((poolErr: unknown) => {
          clearTimeout(forceExit);
          logger.error({ err: poolErr }, "Error while closing database pool");
          exit(1);
        });
    });
  };
}
