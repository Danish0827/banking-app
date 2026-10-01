import type { Account } from "../accounts/account.types.js";

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
