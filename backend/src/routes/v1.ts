import { Router } from "express";
import { createAccountRouter } from "../modules/accounts/account.routes.js";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import { healthRouter } from "../modules/health/health.routes.js";

export function createV1Router(): Router {
  const router = Router();

  router.use("/health", healthRouter);
  router.use("/auth", createAuthRouter());
  router.use("/accounts", createAccountRouter());

  return router;
}
