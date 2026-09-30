/**
 * Base class for errors the API reports to the client on purpose. Anything
 * that is not an AppError is treated as a bug and returned as a generic 500.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export interface FieldError {
  /** Dotted path of the offending field, e.g. `email`. */
  path: string;
  message: string;
}

export class ValidationError extends AppError {
  constructor(fieldErrors: FieldError[]) {
    super(400, "VALIDATION_ERROR", "Request validation failed", fieldErrors);
  }
}

/** Login failed. Deliberately identical for an unknown email and a wrong password. */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
}

/** The request has no valid session. */
export class UnauthenticatedError extends AppError {
  constructor() {
    super(401, "UNAUTHENTICATED", "Authentication required");
  }
}

/**
 * The account does not exist, or it belongs to someone else. Both cases get
 * the same response so a caller cannot probe for other customers' accounts.
 */
export class AccountNotFoundError extends AppError {
  constructor() {
    super(404, "ACCOUNT_NOT_FOUND", "Account not found");
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, "RATE_LIMITED", "Too many attempts. Please try again later.", {
      retryAfterSeconds,
    });
  }
}
