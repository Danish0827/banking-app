import type { Account } from "./accounts";
import { apiFetch } from "./api";

export type MovementType = "deposit" | "withdrawal";

export interface MovementTransaction {
  id: string;
  type: MovementType;
  accountId: string;
  /** Integer cents. */
  amount: number;
  currency: string;
  /** The account balance right after this transaction, in cents. */
  balanceAfter: number;
  createdAt: string;
}

export interface MovementResult {
  transaction: MovementTransaction;
  account: Account;
}

const PATHS: Record<MovementType, string> = {
  deposit: "deposits",
  withdrawal: "withdrawals",
};

/**
 * Deposits into or withdraws from one of the customer's accounts.
 * `amountCents` must already be integer cents; `idempotencyKey` identifies
 * this action, so a retry with the same key is never applied twice.
 */
export function moveMoney(
  type: MovementType,
  accountId: string,
  amountCents: number,
  idempotencyKey: string,
): Promise<MovementResult> {
  return apiFetch<MovementResult>(`/accounts/${encodeURIComponent(accountId)}/${PATHS[type]}`, {
    method: "POST",
    body: { amount: amountCents },
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export interface TransferTransaction {
  id: string;
  type: "transfer";
  sourceAccountId: string;
  destinationAccountId: string;
  /** Integer cents. */
  amount: number;
  currency: string;
  /** The source account's balance right after the transfer, in cents. */
  balanceAfter: number;
  createdAt: string;
}

export interface TransferResult {
  transaction: TransferTransaction;
  /** The source account after the transfer. */
  account: Account;
  /** The destination after the transfer, only if it is one of the customer's own accounts. */
  destinationAccount: Account | null;
}

/** Transfers integer cents from one of the customer's accounts to any account. */
export function transferMoney(
  sourceAccountId: string,
  destinationAccountId: string,
  amountCents: number,
  idempotencyKey: string,
): Promise<TransferResult> {
  return apiFetch<TransferResult>(`/accounts/${encodeURIComponent(sourceAccountId)}/transfers`, {
    method: "POST",
    body: { destinationAccountId, amount: amountCents },
    headers: { "Idempotency-Key": idempotencyKey },
  });
}
