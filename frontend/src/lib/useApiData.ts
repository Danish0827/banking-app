"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";

export type ApiDataState<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  /** `error` is the API's error, or `null` for an unexpected failure. */
  | { status: "error"; error: ApiError | null };

export type ApiData<T> = ApiDataState<T> & {
  /** Fetches the data again. The current data stays visible until the new data arrives. */
  reload: () => void;
};

/**
 * Loads data from the API when the component mounts. If the session has ended
 * (401), the user is sent to the login page instead of seeing an error.
 *
 * `load` must be stable between renders (wrap it in `useCallback`).
 */
export function useApiData<T>(load: (signal: AbortSignal) => Promise<T>): ApiData<T> {
  const router = useRouter();
  const [state, setState] = useState<ApiDataState<T>>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    load(controller.signal)
      .then((data) => setState({ status: "success", data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;

        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setState({ status: "error", error: err instanceof ApiError ? err : null });
      });

    return () => controller.abort();
  }, [load, router, version]);

  return { ...state, reload };
}
