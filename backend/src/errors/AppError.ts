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

export class InsufficientFundsError extends AppError {
  constructor(message = "Insufficient funds for this withdrawal") {
    super(422, "INSUFFICIENT_FUNDS", message);
  }
}

/** A credit would take a balance beyond what can be represented exactly. */
export class BalanceLimitExceededError extends AppError {
  constructor(message = "This deposit would exceed the maximum account balance") {
    super(422, "BALANCE_LIMIT_EXCEEDED", message);
  }
}

export class SameAccountTransferError extends AppError {
  constructor() {
    super(422, "SAME_ACCOUNT_TRANSFER", "Source and destination accounts must be different");
  }
}

/**
 * The transfer's destination does not exist. Unlike the source account, the
 * destination may belong to anyone, so its existence is part of the answer.
 */
export class DestinationAccountNotFoundError extends AppError {
  constructor() {
    super(422, "DESTINATION_ACCOUNT_NOT_FOUND", "Destination account not found");
  }
}

/** The idempotency key was already used for a different request. */
export class IdempotencyConflictError extends AppError {
  constructor() {
    super(
      409,
      "IDEMPOTENCY_CONFLICT",
      "This Idempotency-Key was already used for a different request",
    );
  }
}

/** A browser request from an origin that is neither the app's own nor configured as trusted. */
export class OriginNotAllowedError extends AppError {
  constructor() {
    super(403, "ORIGIN_NOT_ALLOWED", "Cross-origin requests from this origin are not allowed");
  }
}

export class MethodNotAllowedError extends AppError {
  constructor() {
    super(405, "METHOD_NOT_ALLOWED", "This method is not allowed for this endpoint");
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = "Request body must be JSON (Content-Type: application/json)") {
    super(415, "UNSUPPORTED_MEDIA_TYPE", message);
  }
}

/** The service cannot take traffic right now (dependency down, or shutting down). */
export class ServiceUnavailableError extends AppError {
  constructor(details: unknown) {
    super(503, "SERVICE_UNAVAILABLE", "Service is not ready", details);
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, "RATE_LIMITED", "Too many attempts. Please try again later.", {
      retryAfterSeconds,
    });
  }
}
