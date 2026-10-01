import type { Request, RequestHandler, Response } from "express";
import { ValidationError } from "../../errors/AppError.js";
import { getAuth } from "../../middleware/requireAuth.js";
import type { AccountParams } from "../accounts/account.schemas.js";
import type { MovementBody, TransferBody } from "./transaction.schemas.js";
import * as transactionService from "./transaction.service.js";
import * as transferService from "./transfer.service.js";
import type { MovementRequest } from "./transaction.types.js";

function idempotencyKey(req: Request<AccountParams>): string {
  // Set by requireIdempotencyKey; fail closed if the route forgot it.
  if (!req.idempotencyKey) {
    throw new ValidationError([
      { path: "Idempotency-Key", message: "Idempotency-Key is required" },
    ]);
  }
  return req.idempotencyKey;
}

function movementRequest(req: Request<AccountParams>): MovementRequest {
  return {
    accountId: req.params.accountId,
    amount: (req.body as MovementBody).amount,
    idempotencyKey: idempotencyKey(req),
  };
}

/**
 * A replayed request gets the same status and body as the original, plus a
 * header so clients and tests can tell that nothing new happened.
 */
function sendCreated(res: Response, replayed: boolean, data: object): void {
  if (replayed) {
    res.setHeader("Idempotent-Replayed", "true");
  }
  res.status(201).json({ data });
}

export const createDeposit: RequestHandler<AccountParams> = async (req, res) => {
  const { transaction, account, replayed } = await transactionService.deposit(
    getAuth(req),
    movementRequest(req),
  );
  sendCreated(res, replayed, { transaction, account });
};

export const createWithdrawal: RequestHandler<AccountParams> = async (req, res) => {
  const { transaction, account, replayed } = await transactionService.withdraw(
    getAuth(req),
    movementRequest(req),
  );
  sendCreated(res, replayed, { transaction, account });
};

export const createTransfer: RequestHandler<AccountParams> = async (req, res) => {
  const body = req.body as TransferBody;
  const { transaction, account, destinationAccount, replayed } = await transferService.transfer(
    getAuth(req),
    {
      sourceAccountId: req.params.accountId,
      destinationAccountId: body.destinationAccountId,
      amount: body.amount,
      idempotencyKey: idempotencyKey(req),
    },
  );
  sendCreated(res, replayed, { transaction, account, destinationAccount });
};
