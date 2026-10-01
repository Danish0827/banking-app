import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { serializeError } from "../config/logger.js";

const REQUEST_ID_HEADER = "x-request-id";
const HEALTH_PATH = /^\/api\/v1\/health(\/|$)/;

// A caller-supplied id ends up in logs and in a response header, so only a
// short, plain token is accepted. Anything else is replaced, not sanitised.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** The caller's X-Request-Id if it is safe to reuse, otherwise a new random UUID. */
export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** Strips the query string, which can carry data that does not belong in logs. */
function pathOnly(url: string | undefined): string {
  return (url ?? "").split("?", 1)[0] ?? "";
}

/**
 * Assigns every request an id and writes one access log line when it ends.
 *
 * The id is available as `req.id` (and on `req.log`, the per-request logger)
 * for the whole request, is echoed in the X-Request-Id response header, and
 * is included in every error response.
 *
 * Each line records the request id, method, path (without query string),
 * status, duration in milliseconds, the customer id once authenticated, and
 * the error code for failed requests. Headers, cookies and bodies are never
 * logged, so passwords, tokens, amounts, account numbers and idempotency keys
 * cannot reach the logs.
 *
 * Levels: 5xx is `error`; successful health checks are `debug`, so frequent
 * liveness/readiness probes don't flood production logs; everything else is
 * `info` (a 4xx is an expected outcome, classified by its `errorCode`).
 */
export function createRequestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    serializers: {
      req: (req: { id: unknown; method: string; url?: string }) => ({
        id: req.id,
        method: req.method,
        path: pathOnly(req.url),
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      err: serializeError,
    },
    customAttributeKeys: { responseTime: "durationMs" },
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      // originalUrl: by now Express has rewritten req.url relative to the router.
      const path = pathOnly((req as Request).originalUrl ?? req.url);
      if (res.statusCode < 400 && HEALTH_PATH.test(path)) return "debug";
      return "info";
    },
    customSuccessMessage: (_req, res) =>
      res.statusCode >= 400 ? "request failed" : "request completed",
    // pino-http routes every 5xx here; keep one vocabulary for failed requests.
    customErrorMessage: () => "request failed",
    customProps: (req, res) => ({
      // Set by requireAuth: identifies who made the request without credentials.
      customerId: (req as Request).auth?.customerId,
      // Set by sendError: the code the client received.
      errorCode: (res as Response).locals?.errorCode as string | undefined,
    }),
  });
}
