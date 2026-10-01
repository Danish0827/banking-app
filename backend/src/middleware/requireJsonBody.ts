import type { Request, RequestHandler } from "express";
import { UnsupportedMediaTypeError } from "../errors/AppError.js";

/**
 * Whether the request actually carries content. Express's own check counts
 * any Content-Length header as a body, including `Content-Length: 0`, which
 * some clients send (with a default Content-Type) on body-less POSTs.
 */
function hasContent(req: Request): boolean {
  const length = req.get("content-length");
  return req.get("transfer-encoding") !== undefined || (length !== undefined && length !== "0");
}

/**
 * Rejects any request body that is not JSON with 415, before parsing.
 *
 * Every endpoint that takes a body expects JSON. Without this, a form or
 * text/plain body would be silently ignored and surface as a confusing
 * validation error; it would also be the kind of "simple" request a
 * cross-site form can send without a CORS preflight. Requests without content
 * (GETs, logout) are unaffected, whatever Content-Type they declare.
 */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  // Only content that declares another type is refused; content with no
  // Content-Type is not parsed at all.
  if (
    hasContent(req) &&
    req.get("content-type") !== undefined &&
    req.is("application/json") === false
  ) {
    next(new UnsupportedMediaTypeError());
    return;
  }
  next();
};
