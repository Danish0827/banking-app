import { Router } from "express";
import { requireIdempotencyKey } from "../../middleware/idempotencyKey.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody, validateParams } from "../../middleware/validate.js";
import { accountParamsSchema } from "../accounts/account.schemas.js";
import { createDeposit, createTransfer, createWithdrawal } from "./transaction.controller.js";
import { movementBodySchema, transferBodySchema } from "./transaction.schemas.js";

/**
 * Money movements on one account, mounted at /accounts/:accountId. For a
 * transfer, :accountId is the source.
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
  router.post(
    "/transfers",
    requireIdempotencyKey,
    validateBody(transferBodySchema),
    createTransfer,
  );

  return router;
}
