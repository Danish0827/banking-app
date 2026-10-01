import { pool } from "../../db/pool.js";
import type { AuthContext } from "../auth/auth.types.js";
import { findHistoryEntries, type HistoryRow } from "./history.repository.js";
import { DEFAULT_HISTORY_LIMIT, type HistoryQuery } from "./history.schemas.js";
import type { TransactionType } from "./transaction.types.js";

/**
 * One line of a customer's history: how one transaction affected one of their
 * accounts. A transfer between two of the customer's own accounts therefore
 * appears twice, once as sent and once as received, like on a bank statement.
 */
export interface HistoryItem {
  transactionId: string;
  type: TransactionType;
  /** credit: money into `accountId`; debit: money out of it. */
  direction: "credit" | "debit";
  /** Integer cents, always positive; `direction` gives the sign. */
  amount: number;
  currency: string;
  /** The customer's own account this line is about. */
  accountId: string;
  /** That account's balance right after this transaction, in cents. */
  balanceAfter: number;
  /**
   * For transfers only, the other account. `accountId` is shown when the
   * customer owns it or sent the transfer to it, and is null for money
   * received from another customer.
   */
  counterparty: { accountId: string | null; ownedByYou: boolean } | null;
  createdAt: Date;
}

export interface HistoryPage {
  transactions: HistoryItem[];
  /** Pass as `cursor` to get the next (older) page; null on the last page. */
  nextCursor: string | null;
}

function toItem(row: HistoryRow): HistoryItem {
  return {
    transactionId: row.transactionId,
    type: row.type,
    direction: row.direction,
    amount: row.amount,
    currency: row.currency,
    accountId: row.accountId,
    balanceAfter: row.balanceAfter,
    counterparty:
      row.type === "transfer"
        ? { accountId: row.counterpartyAccountId, ownedByYou: row.counterpartyOwned === true }
        : null,
    createdAt: row.createdAt,
  };
}

/** One page of the authenticated customer's history, newest first. */
export async function listHistory(auth: AuthContext, query: HistoryQuery): Promise<HistoryPage> {
  const limit = query.limit ?? DEFAULT_HISTORY_LIMIT;

  // One extra row tells whether another page exists without a COUNT query.
  const rows = await findHistoryEntries(
    pool,
    auth.customerId,
    {
      accountId: query.accountId,
      type: query.type,
      from: query.from,
      to: query.to,
      beforeEntryId: query.cursor,
    },
    limit + 1,
  );

  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    transactions: page.map(toItem),
    nextCursor: rows.length > limit && last ? String(last.entryId) : null,
  };
}
