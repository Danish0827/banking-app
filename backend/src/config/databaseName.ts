const TEST_DATABASE_SUFFIX = "_test";

/** Extracts the database name from a PostgreSQL connection string. */
export function databaseNameFromUrl(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
}

/**
 * Convention used to keep destructive test helpers away from real data: only a
 * database whose name ends in `_test` may be migrated or truncated by tests.
 */
export function isTestDatabaseName(name: string): boolean {
  return name.length > TEST_DATABASE_SUFFIX.length && name.endsWith(TEST_DATABASE_SUFFIX);
}
