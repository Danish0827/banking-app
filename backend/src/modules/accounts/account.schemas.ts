import { z } from "zod";

/**
 * An account id: a UUID, normalised to lower case. PostgreSQL compares UUIDs
 * case-insensitively but JavaScript compares strings exactly, so ids are
 * normalised before any comparison (same-account checks, lock ordering,
 * idempotency matching) can see two spellings of one id.
 */
export function accountIdSchema(message: string) {
  return z.uuid({ error: message }).transform((id) => id.toLowerCase());
}

export const accountParamsSchema = z.object({
  accountId: accountIdSchema("Invalid account id"),
});

export type AccountParams = z.infer<typeof accountParamsSchema>;
