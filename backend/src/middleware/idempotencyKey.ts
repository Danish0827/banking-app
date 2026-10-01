import type { RequestHandler } from "express";
import { ValidationError } from "../errors/AppError.js";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

// Visible ASCII only, at most 255 characters (the database column's limit).
// A UUID generated per user action is the expected value.
const VALID_KEY = /^[\x21-\x7E]{1,255}$/;

/**
 * Requires an `Idempotency-Key` header on money-moving requests and exposes it
 * as `req.idempotencyKey`. The key is never logged.
 */
export const requireIdempotencyKey: RequestHandler = (req, _res, next) => {
  const key = req.get(IDEMPOTENCY_KEY_HEADER);

  if (key === undefined || !VALID_KEY.test(key)) {
    next(
      new ValidationError([
        {
          path: IDEMPOTENCY_KEY_HEADER,
          message:
            key === undefined
              ? "Idempotency-Key header is required"
              : "Idempotency-Key must be 1-255 visible ASCII characters",
        },
      ]),
    );
    return;
  }

  req.idempotencyKey = key;
  next();
};
