import type { RequestHandler } from "express";
import type { z } from "zod";
import { ValidationError } from "../errors/AppError.js";

/**
 * Validates `req.body` against a Zod schema and replaces it with the parsed
 * (trimmed, normalised) value, so handlers can rely on its shape. Failures
 * become a 400 listing each invalid field; submitted values are never echoed.
 */
export function validateBody(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      next(
        new ValidationError(
          result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        ),
      );
      return;
    }

    req.body = result.data;
    next();
  };
}
