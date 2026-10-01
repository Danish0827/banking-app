import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { getAuth } from "../../middleware/requireAuth.js";
import { rateLimitedError } from "../../middleware/rateLimitResponse.js";

const WINDOW_MS = 60 * 1000;

/**
 * Limits deposits, withdrawals and transfers per customer, shared across all
 * three (MONEY_RATE_LIMIT_PER_MINUTE, default 30 per minute).
 *
 * A person using the app makes a handful of these a minute; the limit only
 * stops scripted bursts, e.g. a stolen session draining an account in many
 * small transfers. It is keyed on the authenticated customer, never the IP,
 * because every browser request reaches the API through the same proxy
 * address. Requests count whether or not they succeed, so retry storms are
 * limited too; an idempotent retry is still a request.
 *
 * Must run after requireAuth. Counters are in memory, per instance.
 */
export function createMoneyMovementRateLimiter(limitPerMinute: number): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: limitPerMinute,
    keyGenerator: (req) => getAuth(req).customerId,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // The key is a customer id, not an IP address.
    validate: { xForwardedForHeader: false, trustProxy: false },
    handler: (req, _res, next) => next(rateLimitedError(req, WINDOW_MS)),
  });
}
