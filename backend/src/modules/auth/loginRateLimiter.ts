import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { RateLimitedError } from "../../errors/AppError.js";
import type { LoginInput } from "./auth.schemas.js";

export const LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Limits failed login attempts per account.
 *
 * The limit is keyed on the (normalised) email being tried, not on the client
 * IP. Every request reaches this API through the Next.js proxy, so they all
 * share one source address; an IP-keyed limit would put all customers in a
 * single bucket and let one person lock everybody out. Keying on the email
 * caps password guessing against any one account wherever it comes from, and
 * behaves the same whether or not the email exists.
 *
 * Must run after the body has been validated. Counters are held in memory,
 * which is sufficient for a single instance.
 */
export function createLoginRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_MAX_FAILED_ATTEMPTS,
    keyGenerator: (req) => (req.body as LoginInput).email,
    // Only failures count, so normal use never gets near the limit.
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // The key is not an IP address, so the IP/proxy sanity checks don't apply.
    validate: { xForwardedForHeader: false, trustProxy: false },
    handler: (req, _res, next) => {
      const resetTime = (req as { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const retryAfterMs = resetTime ? resetTime.getTime() - Date.now() : LOGIN_WINDOW_MS;
      next(new RateLimitedError(Math.max(1, Math.ceil(retryAfterMs / 1000))));
    },
  });
}
