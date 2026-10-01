import { z } from "zod";
import { accountIdSchema } from "../accounts/account.schemas.js";

/** Largest single deposit, withdrawal or transfer: $1,000,000.00, in cents. */
export const MAX_MOVEMENT_AMOUNT = 100_000_000;

// Integer minor units (cents): 1050 means $10.50. Strings, decimals,
// NaN/Infinity and anything above the cap are rejected.
const amountSchema = z
  .number({ error: "Amount must be a number of cents" })
  .int({ error: "Amount must be a whole number of cents" })
  .positive({ error: "Amount must be greater than zero" })
  .max(MAX_MOVEMENT_AMOUNT, {
    error: "Amount must not exceed 100000000 cents ($1,000,000.00)",
  });

const UNEXPECTED_FIELD = { error: "Unexpected field in request body" };

export const movementBodySchema = z.strictObject({ amount: amountSchema }, UNEXPECTED_FIELD);

export type MovementBody = z.infer<typeof movementBodySchema>;

export const transferBodySchema = z.strictObject(
  {
    destinationAccountId: accountIdSchema("Invalid destination account id"),
    amount: amountSchema,
  },
  UNEXPECTED_FIELD,
);

export type TransferBody = z.infer<typeof transferBodySchema>;
