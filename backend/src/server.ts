import type { Server } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { checkDatabaseConnection, pool } from "./db/pool.js";
import { markShuttingDown } from "./lifecycle.js";
import { createShutdownHandler } from "./shutdown.js";

// Bound how long a client may take to send a request, so slow or stalled
// connections cannot hold server resources indefinitely.
const HEADERS_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;

async function start(): Promise<Server> {
  // Fail fast: don't accept traffic if the database is unreachable.
  await checkDatabaseConnection();

  const server = createApp().listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "API server listening");
  });
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return server;
}

function registerShutdown(server: Server): void {
  const shutdown = createShutdownHandler({
    server,
    closeDatabase: () => pool.end(),
    logger,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    exit: (code) => process.exit(code),
    onShutdownStart: markShuttingDown,
  });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// A failure nothing caught leaves the process in an unknown state: record it
// (through the safe error serializer) and exit, so a supervisor restarts it.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  process.exit(1);
});

start()
  .then(registerShutdown)
  .catch((err: unknown) => {
    logger.fatal({ err }, "Failed to start API server");
    process.exit(1);
  });
