import type { Queryable } from "../../db/pool.js";
import type { MovementTransaction, MovementType } from "./transaction.types.js";

interface NewMovement {
  type: MovementType;
  accountId: string;
  amount: number;
  currency: string;
  initiatedBy: string;
  idempotencyKey: string;
}

/**
 * Records a deposit or withdrawal. Following the schema, a deposit has only a
 * destination account and a withdrawal only a source account.
 */
export async function insertMovementTransaction(
  client: Queryable,
  movement: NewMovement,
): Promise<{ id: string; createdAt: Date }> {
  const isDeposit = movement.type === "deposit";
  const { rows } = await client.query<{ id: string; createdAt: Date }>(
    `INSERT INTO transactions
       (type, amount, currency, source_account_id, destination_account_id,
        initiated_by, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at AS "createdAt"`,
    [
      movement.type,
      movement.amount,
      movement.currency,
      isDeposit ? null : movement.accountId,
      isDeposit ? movement.accountId : null,
      movement.initiatedBy,
      movement.idempotencyKey,
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
 * account it affected and that account's balance right after it. Returns null
 * if the key is unused. A key belongs to one customer; other customers' keys
 * are never visible.
 */
export async function findTransactionByIdempotencyKey(
  db: Queryable,
  customerId: string,
  idempotencyKey: string,
): Promise<(Omit<MovementTransaction, "type"> & { type: string }) | null> {
  const { rows } = await db.query<Omit<MovementTransaction, "type"> & { type: string }>(
    `SELECT t.id,
            t.type,
            e.account_id AS "accountId",
            t.amount,
            t.currency,
            e.balance_after AS "balanceAfter",
            t.created_at AS "createdAt"
     FROM transactions t
     JOIN ledger_entries e
       ON e.transaction_id = t.id
      AND e.account_id = COALESCE(t.destination_account_id, t.source_account_id)
     WHERE t.initiated_by = $1 AND t.idempotency_key = $2`,
    [customerId, idempotencyKey],
  );
  return rows[0] ?? null;
}
