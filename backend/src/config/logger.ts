import { hostname } from "node:os";
import { pino, stdSerializers, stdTimeFunctions, type DestinationStream } from "pino";
import { env } from "./env.js";

export const SERVICE_NAME = "banking-api";

// PostgreSQL errors can describe the offending row, e.g. "Failing row
// contains (..., 250000, ...)" in `detail`, which may hold balances or account
// numbers. Only the parts needed to diagnose the error are kept.
const OMITTED_ERROR_FIELDS = ["detail", "hint", "where", "internalQuery", "position"];

// Credentials in a connection string, e.g. postgres://user:secret@host/db.
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi;

function maskUrlCredentials(text: unknown): unknown {
  return typeof text === "string" ? text.replace(URL_CREDENTIALS, "$1***@") : text;
}

/**
 * pino's standard error serializer, minus fields that can contain row data,
 * and with any credentials in a URL masked in the message and stack.
 */
export function serializeError(err: unknown): unknown {
  const serialized: unknown = stdSerializers.err(err as Error);
  if (typeof serialized !== "object" || serialized === null) {
    return serialized;
  }
  const fields = serialized as Record<string, unknown>;
  for (const field of OMITTED_ERROR_FIELDS) {
    delete fields[field];
  }
  fields.message = maskUrlCredentials(fields.message);
  fields.stack = maskUrlCredentials(fields.stack);
  return fields;
}

/**
 * The application logger: one JSON object per line, each tagged with the
 * service, environment, process and host, and an ISO timestamp.
 */
export function createLogger(destination?: DestinationStream) {
  return pino(
    {
      level: env.LOG_LEVEL,
      base: { service: SERVICE_NAME, env: env.NODE_ENV, pid: process.pid, hostname: hostname() },
      timestamp: stdTimeFunctions.isoTime,
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
    },
    destination,
  );
}

export const logger = createLogger();
