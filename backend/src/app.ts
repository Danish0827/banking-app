import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import type { Logger } from "pino";
import { env } from "./config/env.js";
import { logger as defaultLogger } from "./config/logger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { originPolicy } from "./middleware/originPolicy.js";
import { requireJsonBody } from "./middleware/requireJsonBody.js";
import { createRequestLogger } from "./middleware/requestLogger.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { createV1Router } from "./routes/v1.js";

interface AppOptions {
  /** Overrides the application logger; tests use it to inspect log output. */
  logger?: Logger;
  /** Overrides CORS_ALLOWED_ORIGINS. */
  corsAllowedOrigins?: readonly string[];
  /** Overrides MONEY_RATE_LIMIT_PER_MINUTE. */
  moneyRateLimitPerMinute?: number;
}

/** Largest accepted JSON body. Every request this API takes is far smaller. */
const JSON_BODY_LIMIT = "10kb";

/**
 * Builds the Express app without binding a port, so tests can drive it
 * directly through Supertest. Each call returns an independent app with its
 * own in-memory state (such as rate-limit counters).
 */
export function createApp({
  logger = defaultLogger,
  corsAllowedOrigins = env.CORS_ALLOWED_ORIGINS,
  moneyRateLimitPerMinute = env.MONEY_RATE_LIMIT_PER_MINUTE,
}: AppOptions = {}): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(securityHeaders({ production: env.NODE_ENV === "production" }));
  app.use(createRequestLogger(logger));

  // Before any body is read: refuse untrusted cross-origin writes and non-JSON bodies.
  app.use("/api", originPolicy(corsAllowedOrigins));
  app.use("/api", requireJsonBody);
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());

  // Responses carry account data and must never be stored by a cache.
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use("/api/v1", createV1Router({ moneyRateLimitPerMinute }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
