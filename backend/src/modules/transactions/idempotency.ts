import { isUniqueViolation } from "../../db/errors.js";
import { pool } from "../../db/pool.js";
import { findTransactionByIdempotencyKey } from "./transaction.repository.js";
import type { StoredTransaction } from "./transaction.types.js";

const IDEMPOTENCY_KEY_CONSTRAINT = "transactions_initiated_by_idempotency_key_key";

/**
 * Runs a money movement and handles the one idempotency race that row locks
 * cannot prevent.
 *
 * Duplicates that touch a common account are serialised by its row lock: the
 * later request finds the committed transaction and replays it. Requests that
 * reuse a key on accounts that don't overlap share no lock, so the later one
 * is stopped by the unique constraint on (initiated_by, idempotency_key). Its
 * work has been rolled back by then; `onDuplicate` answers as if it had
 * arrived second.
 */
export async function withIdempotencyGuard<T>(
  work: () => Promise<T>,
  onDuplicate: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isUniqueViolation(err, IDEMPOTENCY_KEY_CONSTRAINT)) {
      return onDuplicate();
    }
    throw err;
  }
}

/** Loads the committed transaction that won an idempotency race. */
export async function loadCommittedTransaction(
  customerId: string,
  idempotencyKey: string,
): Promise<StoredTransaction> {
  const previous = await findTransactionByIdempotencyKey(pool, customerId, idempotencyKey);
  if (!previous) {
    // Not reachable: the unique constraint only fires once the other row is committed.
    throw new Error("Idempotency key conflict without a committed transaction");
  }
  return previous;
}
