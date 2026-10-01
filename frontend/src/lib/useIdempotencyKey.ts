"use client";

import { useCallback, useRef } from "react";
import { ApiError } from "./api";
import { newIdempotencyKey } from "./idempotency";

/** A failure where we can't know whether the server applied the request. */
export function isOutcomeUnknown(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status >= 500);
}

/**
 * Hands out Idempotency-Keys for financial actions in a form.
 *
 * `keyFor(fingerprint)` describes the action (operation, accounts, amount).
 * A new action gets a fresh key. If the previous request's outcome is unknown
 * (network failure or server error), submitting the same action again gets
 * the same key, so the server applies it at most once. Call `settle` after
 * every request: the key is dropped once the outcome is known.
 */
export function useIdempotencyKey() {
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);

  const keyFor = useCallback((fingerprint: string): string => {
    if (pending.current?.fingerprint === fingerprint) {
      return pending.current.key;
    }
    const key = newIdempotencyKey();
    pending.current = { fingerprint, key };
    return key;
  }, []);

  /** Pass the error if the request failed; omit it after a success. */
  const settle = useCallback((err?: unknown) => {
    if (err === undefined || !isOutcomeUnknown(err)) {
      pending.current = null;
    }
  }, []);

  return { keyFor, settle };
}
