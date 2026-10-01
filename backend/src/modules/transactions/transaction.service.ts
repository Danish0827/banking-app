import { isUniqueViolation } from "../../db/errors.js";
import { pool } from "../../db/pool.js";
import { withTransaction } from "../../db/transaction.js";
import {
  AccountNotFoundError,
  BalanceLimitExceededError,
  IdempotencyConflictError,
  InsufficientFundsError,
} from "../../errors/AppError.js";
import {
  findAccountByIdForCustomer,
  lockAccountForCustomer,
  updateAccountBalance,
} from "../accounts/account.repository.js";
import type { AuthContext } from "../auth/auth.types.js";
import {
  findTransactionByIdempotencyKey,
  insertLedgerEntry,
  insertMovementTransaction,
} from "./transaction.repository.js";
import type {
  MovementRequest,
  MovementResult,
  MovementTransaction,
  MovementType,
} from "./transaction.types.js";

const IDEMPOTENCY_KEY_CONSTRAINT = "transactions_initiated_by_idempotency_key_key";

/**
 * Balances are BIGINT in the database but handled as JavaScript numbers, which
 * are exact only up to 2^53 - 1. A deposit may not take a balance past that.
 */
const MAX_BALANCE = Number.MAX_SAFE_INTEGER;

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
async function moveMoney(
  type: MovementType,
  auth: AuthContext,
  request: MovementRequest,
): Promise<MovementResult> {
  try {
    return await withTransaction(async (client) => {
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
        return { transaction: assertSameRequest(previous, type, request), account, replayed: true };
      }

      const balanceAfter = applyMovement(type, account.balance, request.amount);

      await updateAccountBalance(client, account.id, balanceAfter);
      const recorded = await insertMovementTransaction(client, {
        type,
        accountId: account.id,
        amount: request.amount,
        currency: account.currency,
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
    });
  } catch (err) {
    // Two requests with the same key on *different* accounts don't share a row
    // lock; the loser is stopped by the unique constraint instead. Its work
    // has been rolled back, so answer as if it had arrived second.
    if (isUniqueViolation(err, IDEMPOTENCY_KEY_CONSTRAINT)) {
      return replayCommittedRequest(type, auth, request);
    }
    throw err;
  }
}

/** New balance after the movement, in integer cents. */
function applyMovement(type: MovementType, balance: number, amount: number): number {
  if (type === "deposit") {
    if (amount > MAX_BALANCE - balance) {
      throw new BalanceLimitExceededError();
    }
    return balance + amount;
  }

  if (amount > balance) {
    throw new InsufficientFundsError();
  }
  return balance - amount;
}

/**
 * An idempotency key identifies exactly one request. Reusing it is only valid
 * for the same operation, account and amount; anything else is a client error
 * and must never move money or return an unrelated result.
 */
function assertSameRequest(
  previous: Omit<MovementTransaction, "type"> & { type: string },
  type: MovementType,
  request: MovementRequest,
): MovementTransaction {
  if (
    previous.type !== type ||
    previous.accountId !== request.accountId ||
    previous.amount !== request.amount
  ) {
    throw new IdempotencyConflictError();
  }
  return { ...previous, type };
}

async function replayCommittedRequest(
  type: MovementType,
  auth: AuthContext,
  request: MovementRequest,
): Promise<MovementResult> {
  const previous = await findTransactionByIdempotencyKey(
    pool,
    auth.customerId,
    request.idempotencyKey,
  );
  if (!previous) {
    // Not reachable: the constraint only fires once the other row is committed.
    throw new Error("Idempotency key conflict without a committed transaction");
  }

  const transaction = assertSameRequest(previous, type, request);
  const account = await findAccountByIdForCustomer(pool, request.accountId, auth.customerId);
  if (!account) {
    throw new AccountNotFoundError();
  }
  return { transaction, account, replayed: true };
}
