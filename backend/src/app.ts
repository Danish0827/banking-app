import express, { type Express } from "express";
import helmet from "helmet";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { v1Router } from "./routes/v1.js";

/**
 * Builds the Express app without binding a port, so tests can drive it
 * directly through Supertest.
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(requestLogger);
  app.use(express.json({ limit: "10kb" }));

  app.use("/api/v1", v1Router);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
