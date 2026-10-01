const API_BASE = "/api/v1";

export interface FieldError {
  path: string;
  message: string;
}

/** An error response from the API, or a failure to reach it (`status` 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * Calls the backend through the same-origin `/api` proxy and unwraps the
 * `{ data }` envelope. The session cookie is sent automatically; it is
 * HTTP-only, so this code never sees or handles it.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      credentials: "same-origin",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError(0, "NETWORK_ERROR", "Unable to reach the server");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as ErrorEnvelope | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "UNKNOWN_ERROR",
      error?.message ?? "Something went wrong",
      error?.details,
    );
  }

  return (payload as { data: T }).data;
}
