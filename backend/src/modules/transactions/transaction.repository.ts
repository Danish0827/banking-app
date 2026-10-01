import type { Queryable } from "../../db/pool.js";
import type { StoredTransaction, TransactionType } from "./transaction.types.js";

interface NewTransaction {
  type: TransactionType;
  amount: number;
  currency: string;
  /** Set for withdrawals and transfers. */
  sourceAccountId: string | null;
  /** Set for deposits and transfers. */
  destinationAccountId: string | null;
  initiatedBy: string;
  idempotencyKey: string;
}

/**
 * Records one business operation. Which account columns are set follows the
 * schema's `transactions_accounts_check`: a deposit has only a destination, a
 * withdrawal only a source, and a transfer both (and they must differ).
 */
export async function insertTransaction(
  client: Queryable,
  transaction: NewTransaction,
): Promise<{ id: string; createdAt: Date }> {
  const { rows } = await client.query<{ id: string; createdAt: Date }>(
    `INSERT INTO transactions
       (type, amount, currency, source_account_id, destination_account_id,
        initiated_by, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at AS "createdAt"`,
    [
      transaction.type,
      transaction.amount,
      transaction.currency,
      transaction.sourceAccountId,
      transaction.destinationAccountId,
      transaction.initiatedBy,
      transaction.idempotencyKey,
    ],
  );
  return rows[0] as { id: string; createdAt: Date };
}

export async function insertLedgerEntry(
  client: Queryable,
  entry: {
    transactionId: string;
    accountId: string;
    direction: "credit" | "debit";
    amount: number;
    balanceAfter: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, direction, amount, balance_after)
     VALUES ($1, $2, $3, $4, $5)`,
    [entry.transactionId, entry.accountId, entry.direction, entry.amount, entry.balanceAfter],
  );
}

/**
 * Finds the transaction a customer created with an idempotency key, with the
 * balance each affected account was left with (from its ledger entry).
 * Returns null if the key is unused. A key belongs to one customer; other
 * customers' keys are never visible.
 */
export async function findTransactionByIdempotencyKey(
  db: Queryable,
  customerId: string,
  idempotencyKey: string,
): Promise<StoredTransaction | null> {
  const { rows } = await db.query<StoredTransaction>(
    `SELECT t.id,
            t.type,
            t.amount,
            t.currency,
            t.source_account_id AS "sourceAccountId",
            t.destination_account_id AS "destinationAccountId",
            source_entry.balance_after AS "sourceBalanceAfter",
            destination_entry.balance_after AS "destinationBalanceAfter",
            t.created_at AS "createdAt"
     FROM transactions t
     LEFT JOIN ledger_entries source_entry
       ON source_entry.transaction_id = t.id
      AND source_entry.account_id = t.source_account_id
     LEFT JOIN ledger_entries destination_entry
       ON destination_entry.transaction_id = t.id
      AND destination_entry.account_id = t.destination_account_id
     WHERE t.initiated_by = $1 AND t.idempotency_key = $2`,
    [customerId, idempotencyKey],
  );
  return rows[0] ?? null;
}
