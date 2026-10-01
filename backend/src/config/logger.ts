import { pino, stdSerializers } from "pino";
import { env } from "./env.js";

// PostgreSQL errors can describe the offending row, e.g. "Failing row
// contains (..., 250000, ...)" in `detail`, which may hold balances or account
// numbers. Only the parts needed to diagnose the error are kept.
const OMITTED_ERROR_FIELDS = ["detail", "hint", "where", "internalQuery", "position"];

/** pino's standard error serializer, minus fields that can contain row data. */
export function serializeError(err: unknown): unknown {
  const serialized: unknown = stdSerializers.err(err as Error);
  if (typeof serialized !== "object" || serialized === null) {
    return serialized;
  }
  for (const field of OMITTED_ERROR_FIELDS) {
    delete (serialized as Record<string, unknown>)[field];
  }
  return serialized;
}

export const logger = pino({
  level: env.LOG_LEVEL,
  serializers: { err: serializeError },
  // The request logger does not log headers at all (see middleware/requestLogger.ts).
  // This is a second line of defence in case a header object is ever logged.
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
    "*.password",
    "*.passwordHash",
  ],
});
