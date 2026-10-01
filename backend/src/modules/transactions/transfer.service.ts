import type pg from "pg";
import { pool } from "../../db/pool.js";
import { withTransaction } from "../../db/transaction.js";
import {
  AccountNotFoundError,
  DestinationAccountNotFoundError,
  IdempotencyConflictError,
  SameAccountTransferError,
} from "../../errors/AppError.js";
import {
  findAccountByIdForCustomer,
  lockAccountById,
  lockAccountForCustomer,
  updateAccountBalance,
} from "../accounts/account.repository.js";
import type { Account } from "../accounts/account.types.js";
import type { AuthContext } from "../auth/auth.types.js";
import { credit, debit } from "./balance.js";
import { loadCommittedTransaction, withIdempotencyGuard } from "./idempotency.js";
import {
  findTransactionByIdempotencyKey,
  insertLedgerEntry,
  insertTransaction,
} from "./transaction.repository.js";
import type {
  StoredTransaction,
  TransferRequest,
  TransferResult,
  TransferTransaction,
} from "./transaction.types.js";

/**
 * Moves money from one of the caller's accounts to any other account, which
 * may belong to a different customer. All of it happens in one database
 * transaction:
 *
 *   1. lock both account rows, always in ascending id order;
 *   2. check the caller owns the source and the destination exists;
 *   3. if the idempotency key was used before, return that result instead;
 *   4. debit the source (it must have the funds) and credit the destination;
 *   5. record one `transfer` transaction with a debit and a credit entry.
 *
 * Any failure rolls back every step, including the key.
 */
export async function transfer(
  auth: AuthContext,
  request: TransferRequest,
): Promise<TransferResult> {
  if (request.sourceAccountId === request.destinationAccountId) {
    throw new SameAccountTransferError();
  }

  return withIdempotencyGuard(
    () =>
      withTransaction(async (client) => {
        const { source, destination } = await lockTransferAccounts(client, auth, request);

        const previous = await findTransactionByIdempotencyKey(
          client,
          auth.customerId,
          request.idempotencyKey,
        );
        if (previous) {
          return {
            transaction: asSameTransfer(previous, request),
            account: source,
            destinationAccount: destination.ownedByCaller ? destination.account : null,
            replayed: true,
          };
        }

        const amount = request.amount;
        const sourceBalance = debit(source.balance, amount, "Insufficient funds for this transfer");
        const destinationBalance = credit(
          destination.account.balance,
          amount,
          "This transfer would exceed the destination account's maximum balance",
        );

        await updateAccountBalance(client, source.id, sourceBalance);
        await updateAccountBalance(client, destination.account.id, destinationBalance);

        const recorded = await insertTransaction(client, {
          type: "transfer",
          amount,
          currency: source.currency,
          sourceAccountId: source.id,
          destinationAccountId: destination.account.id,
          initiatedBy: auth.customerId,
          idempotencyKey: request.idempotencyKey,
        });
        await insertLedgerEntry(client, {
          transactionId: recorded.id,
          accountId: source.id,
          direction: "debit",
          amount,
          balanceAfter: sourceBalance,
        });
        await insertLedgerEntry(client, {
          transactionId: recorded.id,
          accountId: destination.account.id,
          direction: "credit",
          amount,
          balanceAfter: destinationBalance,
        });

        return {
          transaction: {
            id: recorded.id,
            type: "transfer",
            sourceAccountId: source.id,
            destinationAccountId: destination.account.id,
            amount,
            currency: source.currency,
            balanceAfter: sourceBalance,
            createdAt: recorded.createdAt,
          },
          account: { ...source, balance: sourceBalance },
          destinationAccount: destination.ownedByCaller
            ? { ...destination.account, balance: destinationBalance }
            : null,
          replayed: false,
        };
      }),
    () => replayCommittedTransfer(auth, request),
  );
}

interface LockedTransferAccounts {
  source: Account;
  destination: { account: Account; ownedByCaller: boolean };
}

/**
 * Locks both rows in ascending account-id order, whichever is the source.
 *
 * If transfers locked "source first", A→B and B→A running together could each
 * hold one row and wait forever for the other (a deadlock). With one global
 * order every transaction waits in the same direction, so no cycle can form.
 * Ids are validated UUIDs normalised to lower case, so string order is a
 * consistent total order.
 *
 * The source is locked only if the caller owns it; someone else's account is
 * treated exactly like one that does not exist.
 */
async function lockTransferAccounts(
  client: pg.PoolClient,
  auth: AuthContext,
  request: TransferRequest,
): Promise<LockedTransferAccounts> {
  const { sourceAccountId, destinationAccountId } = request;
  let source: Account | null;
  let destination: { account: Account; customerId: string } | null;

  if (sourceAccountId < destinationAccountId) {
    source = await lockAccountForCustomer(client, sourceAccountId, auth.customerId);
    destination = await lockAccountById(client, destinationAccountId);
  } else {
    destination = await lockAccountById(client, destinationAccountId);
    source = await lockAccountForCustomer(client, sourceAccountId, auth.customerId);
  }

  if (!source) {
    throw new AccountNotFoundError();
  }
  if (!destination) {
    throw new DestinationAccountNotFoundError();
  }

  return {
    source,
    destination: {
      account: destination.account,
      ownedByCaller: destination.customerId === auth.customerId,
    },
  };
}

/**
 * A key may only be replayed by the identical transfer: same source,
 * destination and amount. Anything else, including a key first used for a
 * deposit or withdrawal, is a conflict.
 */
function asSameTransfer(
  previous: StoredTransaction,
  request: TransferRequest,
): TransferTransaction {
  if (
    previous.type !== "transfer" ||
    previous.sourceAccountId !== request.sourceAccountId ||
    previous.destinationAccountId !== request.destinationAccountId ||
    previous.amount !== request.amount ||
    previous.sourceBalanceAfter === null
  ) {
    throw new IdempotencyConflictError();
  }

  return {
    id: previous.id,
    type: "transfer",
    sourceAccountId: previous.sourceAccountId,
    destinationAccountId: previous.destinationAccountId,
    amount: previous.amount,
    currency: previous.currency,
    balanceAfter: previous.sourceBalanceAfter,
    createdAt: previous.createdAt,
  };
}

async function replayCommittedTransfer(
  auth: AuthContext,
  request: TransferRequest,
): Promise<TransferResult> {
  const previous = await loadCommittedTransaction(auth.customerId, request.idempotencyKey);
  const transaction = asSameTransfer(previous, request);

  const [account, destinationAccount] = await Promise.all([
    findAccountByIdForCustomer(pool, request.sourceAccountId, auth.customerId),
    findAccountByIdForCustomer(pool, request.destinationAccountId, auth.customerId),
  ]);
  if (!account) {
    throw new AccountNotFoundError();
  }
  return { transaction, account, destinationAccount, replayed: true };
}
