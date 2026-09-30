import type { RequestHandler } from "express";
import type { z } from "zod";
import { ValidationError } from "../errors/AppError.js";

/** Converts Zod issues to the API's field errors. Submitted values are never echoed. */
function toValidationError(error: z.ZodError): ValidationError {
  return new ValidationError(
    error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  );
}

/**
 * Validates `req.body` against a Zod schema and replaces it with the parsed
 * (trimmed, normalised) value, so handlers can rely on its shape. Failures
 * become a 400 listing each invalid field.
 */
export function validateBody(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      next(toValidationError(result.error));
      return;
    }

    req.body = result.data;
    next();
  };
}

/** Validates route parameters (such as ids) before they reach a handler or the database. */
export function validateParams(schema: z.ZodType<Record<string, string>>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      next(toValidationError(result.error));
      return;
    }

    req.params = result.data;
    next();
  };
}
