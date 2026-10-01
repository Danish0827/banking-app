import type { RequestHandler } from "express";
import { MethodNotAllowedError } from "../errors/AppError.js";

/**
 * Terminates a route for every method it does not support with 405 and an
 * `Allow` header, instead of letting the request fall through to the 404
 * handler. Attach with `router.route(path).get(...).all(methodNotAllowed(...))`.
 */
export function methodNotAllowed(allowed: readonly string[]): RequestHandler {
  const allow = allowed.join(", ");
  return (_req, res, next) => {
    res.setHeader("Allow", allow);
    next(new MethodNotAllowedError());
  };
}

export const GET_ONLY = ["GET", "HEAD"] as const;
export const POST_ONLY = ["POST"] as const;
