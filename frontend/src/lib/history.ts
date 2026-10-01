import { apiFetch } from "./api";

export type TransactionType = "deposit" | "withdrawal" | "transfer";

/** How one transaction affected one of the customer's accounts. */
export interface HistoryItem {
  transactionId: string;
  type: TransactionType;
  /** credit: money into `accountId`; debit: money out of it. */
  direction: "credit" | "debit";
  /** Integer cents, always positive. */
  amount: number;
  currency: string;
  /** The customer's own account this line is about. */
  accountId: string;
  /** That account's balance right after the transaction, in cents. */
  balanceAfter: number;
  /**
   * Transfers only: the other account. `accountId` is null when the money
   * came from another customer, whose account is never disclosed.
   */
  counterparty: { accountId: string | null; ownedByYou: boolean } | null;
  createdAt: string;
}

export interface HistoryPage {
  transactions: HistoryItem[];
  nextCursor: string | null;
}

export interface HistoryFilters {
  accountId?: string;
  type?: TransactionType;
  /** ISO 8601, inclusive. */
  from?: string;
  /** ISO 8601, exclusive. */
  to?: string;
}

export function listTransactions(
  filters: HistoryFilters,
  page: { limit: number; cursor?: string },
  signal?: AbortSignal,
): Promise<HistoryPage> {
  const params = new URLSearchParams({ limit: String(page.limit) });
  if (page.cursor) params.set("cursor", page.cursor);
  for (const [name, value] of Object.entries(filters)) {
    if (value) params.set(name, value);
  }
  return apiFetch<HistoryPage>(`/transactions?${params.toString()}`, { signal });
}
