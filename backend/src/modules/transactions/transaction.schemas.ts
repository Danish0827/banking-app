import { z } from "zod";

/** Largest single deposit or withdrawal: $1,000,000.00, in cents. */
export const MAX_MOVEMENT_AMOUNT = 100_000_000;

export const movementBodySchema = z.strictObject(
  {
    // Integer minor units (cents): 1050 means $10.50. Strings, decimals,
    // NaN/Infinity and anything above the cap are rejected.
    amount: z
      .number({ error: "Amount must be a number of cents" })
      .int({ error: "Amount must be a whole number of cents" })
      .positive({ error: "Amount must be greater than zero" })
      .max(MAX_MOVEMENT_AMOUNT, {
        error: "Amount must not exceed 100000000 cents ($1,000,000.00)",
      }),
  },
  { error: "Unexpected field in request body" },
);

export type MovementBody = z.infer<typeof movementBodySchema>;
