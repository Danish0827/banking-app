import type { Request, RequestHandler } from "express";
import { UnauthenticatedError } from "../errors/AppError.js";
import type { AuthContext } from "../modules/auth/auth.types.js";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../modules/auth/session.js";

/**
 * Requires a valid session. On success the caller's identity is available as
 * `req.auth`; a missing, invalid or expired session is rejected with 401.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const auth = await verifySessionToken(cookies?.[SESSION_COOKIE_NAME]);

  if (!auth) {
    next(new UnauthenticatedError());
    return;
  }

  req.auth = auth;
  next();
};

/**
 * Returns the authenticated identity for a request behind `requireAuth`.
 * Throws rather than returning undefined, so a route that forgot the
 * middleware fails closed.
 */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw new UnauthenticatedError();
  }
  return req.auth;
}
