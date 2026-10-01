import type { Request, Response } from "express";

export interface ErrorBody {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Sends the API's single error shape:
 *
 *   { "error": { "code", "message", "details"?, "requestId" } }
 *
 * and records the code for the access log line (see requestLogger.ts), so
 * every failed request is classified in the logs by the same code the client
 * received.
 */
export function sendError(
  req: Request,
  res: Response,
  { status, code, message, details }: ErrorBody,
): void {
  res.locals.errorCode = code;
  res.status(status).json({
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
      requestId: String(req.id),
    },
  });
}
