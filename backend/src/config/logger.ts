import { pino } from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
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
