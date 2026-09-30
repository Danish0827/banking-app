import { Router } from "express";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import { healthRouter } from "../modules/health/health.routes.js";

export function createV1Router(): Router {
  const router = Router();

  router.use("/health", healthRouter);
  router.use("/auth", createAuthRouter());

  return router;
}
