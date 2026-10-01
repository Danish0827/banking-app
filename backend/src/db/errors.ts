// PostgreSQL error codes the application reacts to.
const UNIQUE_VIOLATION = "23505";

/** True if `err` is a unique-constraint violation on the named constraint. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION &&
    (err as { constraint?: unknown }).constraint === constraint
  );
}
