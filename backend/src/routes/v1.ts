import { Router } from "express";
import { createAccountRouter } from "../modules/accounts/account.routes.js";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import type { ReadinessOptions } from "../modules/health/health.controller.js";
import { createHealthRouter } from "../modules/health/health.routes.js";
import { createTransactionHistoryRouter } from "../modules/transactions/history.routes.js";
import { createAccountTransactionRouter } from "../modules/transactions/transaction.routes.js";

export interface V1RouterOptions {
  moneyRateLimitPerMinute: number;
  readiness: ReadinessOptions;
}

export function createV1Router({ moneyRateLimitPerMinute, readiness }: V1RouterOptions): Router {
  const router = Router();

  router.use("/health", createHealthRouter(readiness));
  router.use("/auth", createAuthRouter());
  router.use("/accounts", createAccountRouter());
  router.use("/accounts/:accountId", createAccountTransactionRouter({ moneyRateLimitPerMinute }));
  router.use("/transactions", createTransactionHistoryRouter());

  return router;
}
