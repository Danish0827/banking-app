import type { Request, RequestHandler } from "express";
import { OriginNotAllowedError } from "../errors/AppError.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_METHODS = "GET, HEAD, POST";
const ALLOWED_HEADERS = "Content-Type, Idempotency-Key, X-Request-Id";
const EXPOSED_HEADERS =
  "X-Request-Id, Idempotent-Replayed, Retry-After, RateLimit, RateLimit-Policy";
const PREFLIGHT_MAX_AGE_SECONDS = "600";

/**
 * Whether the browser origin is the site the request was addressed to. The
 * web app calls the API through its own same-origin proxy, which forwards the
 * browser's Origin header together with its own host in X-Forwarded-Host.
 *
 * A web page cannot fake that header on a cross-origin request: setting a
 * custom header forces a CORS preflight, which this policy refuses for
 * untrusted origins, so the real request is never sent.
 */
function isSameOrigin(origin: string, req: Request): boolean {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false; // e.g. "null" from sandboxed frames or file:// pages
  }
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  return host === (forwardedHost || req.get("host"));
}

/**
 * CORS and cross-site request protection, driven by CORS_ALLOWED_ORIGINS.
 *
 * - Trusted origins (exactly as configured) get CORS headers with
 *   credentials, echoing the specific origin. A wildcard is never used.
 * - Preflight requests from any other origin are refused with 403.
 * - State-changing requests (anything but GET/HEAD/OPTIONS) that carry an
 *   Origin which is neither trusted nor the request's own site are refused
 *   with 403 before any handler runs. This is CSRF defence in depth on top
 *   of SameSite=Lax cookies, which still treat other ports and subdomains of
 *   the same site as "same-site".
 * - Requests without an Origin header (same-origin GETs, curl, server-to-
 *   server) are unaffected.
 */
export function originPolicy(allowedOrigins: readonly string[]): RequestHandler {
  const trusted = new Set(allowedOrigins);

  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin === undefined) {
      next();
      return;
    }

    res.vary("Origin");
    const isTrusted = trusted.has(origin);

    if (isTrusted) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS);
    }

    const isPreflight = req.method === "OPTIONS" && req.get("access-control-request-method");
    if (isPreflight) {
      if (!isTrusted) {
        next(new OriginNotAllowedError());
        return;
      }
      res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
      res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
      res.setHeader("Access-Control-Max-Age", PREFLIGHT_MAX_AGE_SECONDS);
      res.status(204).end();
      return;
    }

    if (!SAFE_METHODS.has(req.method) && !isTrusted && !isSameOrigin(origin, req)) {
      next(new OriginNotAllowedError());
      return;
    }

    next();
  };
}
