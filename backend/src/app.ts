import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { logger as defaultLogger } from "./config/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { createRequestLogger } from "./middleware/requestLogger.js";
import { createV1Router } from "./routes/v1.js";

interface AppOptions {
  /** Overrides the application logger; tests use it to inspect log output. */
  logger?: Logger;
}

/**
 * Builds the Express app without binding a port, so tests can drive it
 * directly through Supertest. Each call returns an independent app with its
 * own in-memory state (such as rate-limit counters).
 */
export function createApp({ logger = defaultLogger }: AppOptions = {}): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(createRequestLogger(logger));
  app.use(express.json({ limit: "10kb" }));
  app.use(cookieParser());

  // Responses carry account data and must never be stored by a cache.
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use("/api/v1", createV1Router());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
