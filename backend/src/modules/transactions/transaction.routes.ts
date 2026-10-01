import { Router } from "express";
import { requireIdempotencyKey } from "../../middleware/idempotencyKey.js";
import { methodNotAllowed, POST_ONLY } from "../../middleware/methodNotAllowed.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { accountParamsSchema } from "../accounts/account.schemas.js";
import { createMoneyMovementRateLimiter } from "./moneyRateLimiter.js";
import { createDeposit, createTransfer, createWithdrawal } from "./transaction.controller.js";
import { movementBodySchema, transferBodySchema } from "./transaction.schemas.js";

interface AccountTransactionRouterOptions {
  /** Deposits, withdrawals and transfers allowed per customer per minute. */
  moneyRateLimitPerMinute: number;
}

/**
 * Money movements on one account, mounted at /accounts/:accountId. For a
 * transfer, :accountId is the source.
 * Checks run in order: session, account id, rate limit, Idempotency-Key, body.
 */
export function createAccountTransactionRouter({
  moneyRateLimitPerMinute,
}: AccountTransactionRouterOptions): Router {
  const router = Router({ mergeParams: true });
  // One limiter, so the limit covers all three operations together.
  const rateLimit = createMoneyMovementRateLimiter(moneyRateLimitPerMinute);

  router.use(requireAuth, validateParams(accountParamsSchema));

  router
    .route("/deposits")
    .post(rateLimit, requireIdempotencyKey, validateBody(movementBodySchema), createDeposit)
    .all(methodNotAllowed(POST_ONLY));
  router
    .route("/withdrawals")
    .post(rateLimit, requireIdempotencyKey, validateBody(movementBodySchema), createWithdrawal)
    .all(methodNotAllowed(POST_ONLY));
  router
    .route("/transfers")
    .post(rateLimit, requireIdempotencyKey, validateBody(transferBodySchema), createTransfer)
    .all(methodNotAllowed(POST_ONLY));

  return router;
}
