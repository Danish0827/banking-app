import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { serializeError } from "../config/logger.js";

const REQUEST_ID_HEADER = "x-request-id";

// A caller-supplied id ends up in logs and in a response header, so only a
// short, plain token is accepted. Anything else is replaced, not sanitised.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** Strips the query string, which can carry data that does not belong in logs. */
function pathOnly(url: string | undefined): string {
  return (url ?? "").split("?", 1)[0] ?? "";
}

/**
 * Logs one line per request and assigns each request an id, echoed back in
 * the X-Request-Id header and included in error responses.
 *
 * Only the method, path, status and duration are logged. Headers and bodies
 * are deliberately left out so cookies, tokens and passwords cannot reach the
 * logs.
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
    // Set by requireAuth; identifies who made the request without logging credentials.
    customProps: (req) => ({ customerId: (req as Request).auth?.customerId }),
  });
}
