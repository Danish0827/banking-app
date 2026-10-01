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
