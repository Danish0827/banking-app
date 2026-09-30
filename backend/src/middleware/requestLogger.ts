import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import { logger } from "../config/logger.js";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Logs every request and assigns it an id (reusing an incoming X-Request-Id
 * when present). The id is echoed back in the response header and included in
 * error responses so a client report can be matched to a log line.
 */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id = typeof incoming === "string" && incoming.length > 0 ? incoming : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, id);
    return id;
  },
});
