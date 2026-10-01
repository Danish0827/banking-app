import { Writable } from "node:stream";
import { createLogger } from "../../src/config/logger.js";

export interface LogLine {
  level: number;
  msg: string;
  [field: string]: unknown;
}

/**
 * A logger configured exactly like the application's (fields, serializers,
 * redaction) but writing to memory at the most verbose level.
 */
export function captureLogs() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger(destination);
  logger.level = "trace";

  return {
    logger,
    /** Everything written so far, as one string. */
    text: () => lines.join(""),
    /** Every line, parsed. */
    entries: () => lines.map((line) => JSON.parse(line) as LogLine),
    /** Access log lines (one per completed request). */
    accessLines: () =>
      lines
        .map((line) => JSON.parse(line) as LogLine)
        .filter((entry) => entry.req !== undefined && entry.res !== undefined),
  };
}

export const LEVEL = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } as const;
