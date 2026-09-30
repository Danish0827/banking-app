import "dotenv/config";
import { databaseNameFromUrl, isTestDatabaseName } from "../../src/config/databaseName.js";
import { runMigrations } from "../../src/db/migrate.js";

/**
 * Runs once before the whole suite: brings the test database schema up to
 * date. Reads TEST_DATABASE_URL directly (never DATABASE_URL) and insists on a
 * "_test" database name before touching anything.
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Copy backend/.env.example to backend/.env before running the tests.",
    );
  }

  const name = databaseNameFromUrl(databaseUrl);
  if (!isTestDatabaseName(name)) {
    throw new Error(
      `TEST_DATABASE_URL points at "${name}". Tests only run against a database whose name ends in "_test".`,
    );
  }

  await runMigrations({ databaseUrl });
}
