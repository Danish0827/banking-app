import type { Request } from "express";
import { RateLimitedError } from "../errors/AppError.js";

/**
 * The error for a request that hit an express-rate-limit limit, with the
 * seconds until the window resets (also sent as the Retry-After header).
 */
export function rateLimitedError(req: Request, windowMs: number): RateLimitedError {
  const resetTime = (req as { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
  const retryAfterMs = resetTime ? resetTime.getTime() - Date.now() : windowMs;
  return new RateLimitedError(Math.max(1, Math.ceil(retryAfterMs / 1000)));
}
