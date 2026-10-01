import type { RequestHandler } from "express";
import { UnsupportedMediaTypeError } from "../errors/AppError.js";

/**
 * Rejects any request body that is not JSON with 415, before parsing.
 *
 * Every endpoint that takes a body expects JSON. Without this, a form or
 * text/plain body would be silently ignored and surface as a confusing
 * validation error; it would also be the kind of "simple" request a
 * cross-site form can send without a CORS preflight. Requests without a body
 * (GETs, logout) are unaffected.
 */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  // Only a body that declares another type is refused. `req.is` returns null
  // when there is no body; a body with no Content-Type is not parsed at all.
  if (req.get("content-type") !== undefined && req.is("application/json") === false) {
    next(new UnsupportedMediaTypeError());
    return;
  }
  next();
};
