import type { Queryable } from "../../db/pool.js";
import type { TransactionType } from "./transaction.types.js";

export interface HistoryFilters {
  accountId?: string;
  type?: TransactionType;
  /** Inclusive. */
  from?: Date;
  /** Exclusive. */
  to?: Date;
  /** Keyset cursor: only entries with a smaller ledger id (older) are returned. */
  beforeEntryId?: number;
}

export interface HistoryRow {
  entryId: number;
  transactionId: string;
  type: TransactionType;
  direction: "credit" | "debit";
  amount: number;
  currency: string;
  accountId: string;
  balanceAfter: number;
  /** The other account of a transfer, when the customer may see it (see below). */
  counterpartyAccountId: string | null;
  /** Whether the customer owns the other account of a transfer; null otherwise. */
  counterpartyOwned: boolean | null;
  createdAt: Date;
}

/**
 * One page of a customer's history: the ledger entries on accounts they own,
 * newest first, with the transaction each entry belongs to.
 *
 * - Ownership is part of the query (`owned.customer_id = $1`), so entries on
 *   other customers' accounts are never read, whatever the filters say. A
 *   transfer appears for each side the customer owns, and only that side's
 *   amount, direction and balance are returned.
 * - The other account of a transfer is returned only if the customer owns it,
 *   or sent the transfer (and so chose that account). The account that sent
 *   money *to* the customer stays hidden; nothing else about another
 *   customer's account (number, balance, owner) is selected at all.
 * - Pagination is keyset on the monotonic ledger entry id, and `limit` is
 *   applied in SQL, so a page never reads more than `limit` rows.
 *
 * Every filter value is passed as a parameter; only fixed SQL fragments are
 * added to the query.
 */
export async function findHistoryEntries(
  db: Queryable,
  customerId: string,
  filters: HistoryFilters,
  limit: number,
): Promise<HistoryRow[]> {
  const params: unknown[] = [customerId];
  const conditions = ["owned.customer_id = $1"];
  const where = (fragment: (placeholder: string) => string, value: unknown) => {
    params.push(value);
    conditions.push(fragment(`$${params.length}`));
  };

  if (filters.accountId !== undefined) where((p) => `e.account_id = ${p}`, filters.accountId);
  if (filters.type !== undefined) where((p) => `t.type = ${p}`, filters.type);
  if (filters.from !== undefined) where((p) => `e.created_at >= ${p}`, filters.from);
  if (filters.to !== undefined) where((p) => `e.created_at < ${p}`, filters.to);
  if (filters.beforeEntryId !== undefined) where((p) => `e.id < ${p}`, filters.beforeEntryId);

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;

  const { rows } = await db.query<HistoryRow>(
    `SELECT e.id AS "entryId",
            t.id AS "transactionId",
            t.type,
            e.direction,
            e.amount,
            t.currency,
            e.account_id AS "accountId",
            e.balance_after AS "balanceAfter",
            CASE WHEN other.customer_id = $1 OR e.direction = 'debit' THEN other.id END
              AS "counterpartyAccountId",
            other.customer_id = $1 AS "counterpartyOwned",
            t.created_at AS "createdAt"
     FROM ledger_entries e
     JOIN accounts owned ON owned.id = e.account_id
     JOIN transactions t ON t.id = e.transaction_id
     LEFT JOIN accounts other
       ON t.type = 'transfer'
      AND other.id = CASE e.direction
                       WHEN 'debit' THEN t.destination_account_id
                       ELSE t.source_account_id
                     END
     WHERE ${conditions.join(" AND ")}
     ORDER BY e.id DESC
     LIMIT ${limitPlaceholder}`,
    params,
  );
  return rows;
}
