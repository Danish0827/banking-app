import type { Account } from "../accounts/account.types.js";

export type TransactionType = "deposit" | "withdrawal" | "transfer";

/** Operations that move money into or out of a single account. */
export type MovementType = "deposit" | "withdrawal";

/** A deposit or withdrawal as returned by the API. Amounts are integer cents. */
export interface MovementTransaction {
  id: string;
  type: MovementType;
  /** The account the money went into (deposit) or came out of (withdrawal). */
  accountId: string;
  amount: number;
  currency: string;
  /** The account's balance immediately after this transaction. */
  balanceAfter: number;
  createdAt: Date;
}

export interface MovementRequest {
  accountId: string;
  amount: number;
  idempotencyKey: string;
}

export interface MovementResult {
  transaction: MovementTransaction;
  /** The account as it is now. */
  account: Account;
  /** True when an earlier request with the same Idempotency-Key is being returned. */
  replayed: boolean;
}

/** A transfer as returned to the customer who sent it. Amounts are integer cents. */
export interface TransferTransaction {
  id: string;
  type: "transfer";
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  currency: string;
  /** The source account's balance immediately after the transfer. */
  balanceAfter: number;
  createdAt: Date;
}

export interface TransferRequest {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  idempotencyKey: string;
}

export interface TransferResult {
  transaction: TransferTransaction;
  /** The source account as it is now. */
  account: Account;
  /**
   * The destination account as it is now, only when the sender owns it.
   * Another customer's account details and balance are never returned.
   */
  destinationAccount: Account | null;
  replayed: boolean;
}

/**
 * A transaction as stored, with the balance each side was left with. Used to
 * answer a repeated Idempotency-Key with the original result.
 */
export interface StoredTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: string;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  sourceBalanceAfter: number | null;
  destinationBalanceAfter: number | null;
  createdAt: Date;
}
