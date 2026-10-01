import type { ErrorRequestHandler } from "express";
import { AppError } from "../errors/AppError.js";

interface ErrorBody {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Errors raised by Express's body parser, keyed by their `type`. */
const BODY_PARSER_ERRORS: Record<string, ErrorBody> = {
  "entity.parse.failed": {
    status: 400,
    code: "INVALID_JSON",
    message: "Request body is not valid JSON",
  },
  "entity.too.large": {
    status: 413,
    code: "PAYLOAD_TOO_LARGE",
    message: "Request body is too large",
  },
  "charset.unsupported": {
    status: 415,
    code: "UNSUPPORTED_MEDIA_TYPE",
    message: "Request body must be UTF-8 encoded JSON",
  },
  "encoding.unsupported": {
    status: 415,
    code: "UNSUPPORTED_MEDIA_TYPE",
    message: "Unsupported Content-Encoding",
  },
};

/** Any other client error raised by Express itself (e.g. a malformed %-escape in the URL). */
const MALFORMED_REQUEST: ErrorBody = {
  status: 400,
  code: "BAD_REQUEST",
  message: "The request is malformed",
};

function clientErrorStatus(err: object): number | undefined {
  const status =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  return typeof status === "number" && status >= 400 && status < 500 ? status : undefined;
}

function toErrorBody(err: unknown): ErrorBody | undefined {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }
  if (typeof err !== "object" || err === null) {
    return undefined;
  }
  if ("type" in err && typeof err.type === "string" && BODY_PARSER_ERRORS[err.type]) {
    return BODY_PARSER_ERRORS[err.type];
  }
  // Library errors flagged as the client's fault get a fixed, generic answer;
  // their own messages can quote request internals and are never returned.
  return clientErrorStatus(err) !== undefined ? MALFORMED_REQUEST : undefined;
}

/**
 * Central error handler. Application errors and known client errors keep
 * their own status and code; anything else is logged and returned as a
 * generic 500 so internals never reach the client.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const known = toErrorBody(err);
  if (known) {
    res.status(known.status).json({
      error: {
        code: known.code,
        message: known.message,
        ...(known.details !== undefined && { details: known.details }),
        requestId: String(req.id),
      },
    });
    return;
  }

  req.log.error({ err }, "Unhandled error");

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      requestId: String(req.id),
    },
  });
};
