import { withTransaction } from "../../db/transaction.js";
import { AccountNotFoundError, IdempotencyConflictError } from "../../errors/AppError.js";
import { pool } from "../../db/pool.js";
import {
  findAccountByIdForCustomer,
  lockAccountForCustomer,
  updateAccountBalance,
} from "../accounts/account.repository.js";
import type { AuthContext } from "../auth/auth.types.js";
import { credit, debit } from "./balance.js";
import { loadCommittedTransaction, withIdempotencyGuard } from "./idempotency.js";
import {
  findTransactionByIdempotencyKey,
  insertLedgerEntry,
  insertTransaction,
} from "./transaction.repository.js";
import type {
  MovementRequest,
  MovementResult,
  MovementTransaction,
  MovementType,
  StoredTransaction,
} from "./transaction.types.js";

export function deposit(auth: AuthContext, request: MovementRequest): Promise<MovementResult> {
  return moveMoney("deposit", auth, request);
}

export function withdraw(auth: AuthContext, request: MovementRequest): Promise<MovementResult> {
  return moveMoney("withdrawal", auth, request);
}

/**
 * Applies a deposit or withdrawal in one database transaction:
 *
 *   1. lock the account row (only if the caller owns it);
 *   2. if the idempotency key was used before, return that result instead;
 *   3. compute the new balance from the locked row (withdrawals need funds);
 *   4. update the balance, record the transaction and its ledger entry.
 *
 * Any failure rolls back every step. Because the row stays locked until
 * COMMIT, concurrent movements on the same account run one after another and
 * each sees the balance left by the previous one.
 */
function moveMoney(
  type: MovementType,
  auth: AuthContext,
  request: MovementRequest,
): Promise<MovementResult> {
  return withIdempotencyGuard(
    () =>
      withTransaction(async (client) => {
        const account = await lockAccountForCustomer(client, request.accountId, auth.customerId);
        if (!account) {
          throw new AccountNotFoundError();
        }

        const previous = await findTransactionByIdempotencyKey(
          client,
          auth.customerId,
          request.idempotencyKey,
        );
        if (previous) {
          return { transaction: asSameMovement(previous, type, request), account, replayed: true };
        }

        const balanceAfter =
          type === "deposit"
            ? credit(account.balance, request.amount)
            : debit(account.balance, request.amount);

        await updateAccountBalance(client, account.id, balanceAfter);
        const recorded = await insertTransaction(client, {
          type,
          amount: request.amount,
          currency: account.currency,
          sourceAccountId: type === "withdrawal" ? account.id : null,
          destinationAccountId: type === "deposit" ? account.id : null,
          initiatedBy: auth.customerId,
          idempotencyKey: request.idempotencyKey,
        });
        await insertLedgerEntry(client, {
          transactionId: recorded.id,
          accountId: account.id,
          direction: type === "deposit" ? "credit" : "debit",
          amount: request.amount,
          balanceAfter,
        });

        return {
          transaction: {
            id: recorded.id,
            type,
            accountId: account.id,
            amount: request.amount,
            currency: account.currency,
            balanceAfter,
            createdAt: recorded.createdAt,
          },
          account: { ...account, balance: balanceAfter },
          replayed: false,
        };
      }),
    () => replayCommittedMovement(type, auth, request),
  );
}

/**
 * An idempotency key identifies exactly one request. Reusing it is only valid
 * for the same operation, account and amount; anything else is a client error
 * and must never move money or return an unrelated result.
 */
function asSameMovement(
  previous: StoredTransaction,
  type: MovementType,
  request: MovementRequest,
): MovementTransaction {
  const accountId = type === "deposit" ? previous.destinationAccountId : previous.sourceAccountId;
  const balanceAfter =
    type === "deposit" ? previous.destinationBalanceAfter : previous.sourceBalanceAfter;

  if (
    previous.type !== type ||
    accountId !== request.accountId ||
    previous.amount !== request.amount ||
    balanceAfter === null
  ) {
    throw new IdempotencyConflictError();
  }

  return {
    id: previous.id,
    type,
    accountId,
    amount: previous.amount,
    currency: previous.currency,
    balanceAfter,
    createdAt: previous.createdAt,
  };
}

async function replayCommittedMovement(
  type: MovementType,
  auth: AuthContext,
  request: MovementRequest,
): Promise<MovementResult> {
  const previous = await loadCommittedTransaction(auth.customerId, request.idempotencyKey);
  const transaction = asSameMovement(previous, type, request);

  const account = await findAccountByIdForCustomer(pool, request.accountId, auth.customerId);
  if (!account) {
    throw new AccountNotFoundError();
  }
  return { transaction, account, replayed: true };
}
