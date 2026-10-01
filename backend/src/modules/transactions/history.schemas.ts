import { z } from "zod";
import { accountIdSchema } from "../accounts/account.schemas.js";

export const DEFAULT_HISTORY_LIMIT = 20;
export const MAX_HISTORY_LIMIT = 100;

/** A point in time: an ISO 8601 date-time with offset, or a date (midnight UTC). */
const timestampParam = (name: string) =>
  z
    .union([z.iso.datetime({ offset: true }), z.iso.date()], {
      error: `${name} must be an ISO 8601 date or date-time, e.g. 2026-10-01 or 2026-10-01T09:30:00Z`,
    })
    .transform((value) => new Date(value));

/**
 * Query parameters for GET /transactions. Only these are accepted; anything
 * else (including a customerId) is rejected rather than ignored.
 */
export const historyQuerySchema = z
  .strictObject(
    {
      limit: z
        .string()
        .regex(/^\d{1,3}$/, {
          error: `limit must be a whole number from 1 to ${MAX_HISTORY_LIMIT}`,
        })
        .transform(Number)
        .pipe(
          z
            .number()
            .min(1, { error: `limit must be a whole number from 1 to ${MAX_HISTORY_LIMIT}` })
            .max(MAX_HISTORY_LIMIT, {
              error: `limit must be a whole number from 1 to ${MAX_HISTORY_LIMIT}`,
            }),
        )
        .optional(),
      // Opaque to clients: the value of nextCursor from the previous page.
      cursor: z
        .string()
        .regex(/^[1-9]\d{0,14}$/, { error: "cursor is not valid" })
        .transform(Number)
        .optional(),
      type: z
        .enum(["deposit", "withdrawal", "transfer"], {
          error: "type must be one of deposit, withdrawal, transfer",
        })
        .optional(),
      accountId: accountIdSchema("Invalid account id").optional(),
      from: timestampParam("from").optional(),
      to: timestampParam("to").optional(),
    },
    { error: "Unexpected query parameter" },
  )
  .refine((query) => !query.from || !query.to || query.from < query.to, {
    error: "to must be later than from",
    path: ["to"],
  });

export type HistoryQuery = z.infer<typeof historyQuerySchema>;
