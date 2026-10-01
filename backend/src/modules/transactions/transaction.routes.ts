import { Router } from "express";
import { requireIdempotencyKey } from "../../middleware/idempotencyKey.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { accountParamsSchema } from "../accounts/account.schemas.js";
import { createDeposit, createWithdrawal } from "./transaction.controller.js";
import { movementBodySchema } from "./transaction.schemas.js";

/**
 * Money movements on one account, mounted at /accounts/:accountId.
 * Checks run in order: session, account id, Idempotency-Key, body.
 */
export function createAccountTransactionRouter(): Router {
  const router = Router({ mergeParams: true });

  router.use(requireAuth, validateParams(accountParamsSchema));

  router.post("/deposits", requireIdempotencyKey, validateBody(movementBodySchema), createDeposit);
  router.post(
    "/withdrawals",
    requireIdempotencyKey,
    validateBody(movementBodySchema),
    createWithdrawal,
  );

  return router;
}
