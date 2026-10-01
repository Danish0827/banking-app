import type { Request, RequestHandler, Response } from "express";
import { ValidationError } from "../../errors/AppError.js";
import { getAuth } from "../../middleware/requireAuth.js";
import type { AccountParams } from "../accounts/account.schemas.js";
import type { MovementBody } from "./transaction.schemas.js";
import * as transactionService from "./transaction.service.js";
import type { MovementRequest, MovementResult } from "./transaction.types.js";

function movementRequest(req: Request<AccountParams>): MovementRequest {
  // Set by requireIdempotencyKey; fail closed if the route forgot it.
  if (!req.idempotencyKey) {
    throw new ValidationError([
      { path: "Idempotency-Key", message: "Idempotency-Key is required" },
    ]);
  }
  return {
    accountId: req.params.accountId,
    amount: (req.body as MovementBody).amount,
    idempotencyKey: req.idempotencyKey,
  };
}

/**
 * A replayed request gets the same status and body as the original, plus a
 * header so clients and tests can tell that nothing new happened.
 */
function sendResult(res: Response, { transaction, account, replayed }: MovementResult): void {
  if (replayed) {
    res.setHeader("Idempotent-Replayed", "true");
  }
  res.status(201).json({ data: { transaction, account } });
}

export const createDeposit: RequestHandler<AccountParams> = async (req, res) => {
  sendResult(res, await transactionService.deposit(getAuth(req), movementRequest(req)));
};

export const createWithdrawal: RequestHandler<AccountParams> = async (req, res) => {
  sendResult(res, await transactionService.withdraw(getAuth(req), movementRequest(req)));
};
