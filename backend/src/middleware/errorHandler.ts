import type { ErrorRequestHandler } from "express";

interface ClientError {
  status: number;
  code: string;
  message: string;
}

/** Errors raised by Express's body parser, keyed by their `type`. */
const BODY_PARSER_ERRORS: Record<string, ClientError> = {
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
};

function toClientError(err: unknown): ClientError | undefined {
  if (typeof err === "object" && err !== null && "type" in err && typeof err.type === "string") {
    return BODY_PARSER_ERRORS[err.type];
  }
  return undefined;
}

/**
 * Central error handler. Known client errors get their own status and code;
 * anything else is logged and returned as a generic 500 so internals never
 * reach the client. Typed application errors are mapped here once the domain
 * modules are added.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const clientError = toClientError(err);
  if (clientError) {
    res.status(clientError.status).json({
      error: {
        code: clientError.code,
        message: clientError.message,
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
