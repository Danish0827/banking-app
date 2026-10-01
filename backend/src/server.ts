import type { Server } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { checkDatabaseConnection, pool } from "./db/pool.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

// Bound how long a client may take to send a request, so slow or stalled
// connections cannot hold server resources indefinitely.
const HEADERS_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;

async function start(): Promise<Server> {
  // Fail fast: don't accept traffic if the database is unreachable.
  await checkDatabaseConnection();

  const server = createApp().listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "API server listening");
  });
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return server;
}

function registerShutdown(server: Server): void {
  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, "Shutting down");

    // Stop accepting requests, let in-flight ones finish, then close the pool.
    server.close((err) => {
      if (err) logger.error({ err }, "Error while closing server");

      pool
        .end()
        .catch((poolErr: unknown) => {
          logger.error({ err: poolErr }, "Error while closing database pool");
        })
        .finally(() => process.exit(err ? 1 : 0));
    });

    // Don't let a hung connection keep the process alive indefinitely.
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start()
  .then(registerShutdown)
  .catch((err: unknown) => {
    logger.fatal({ err }, "Failed to start API server");
    process.exit(1);
  });
