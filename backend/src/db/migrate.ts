import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

export type MigrationDirection = "up" | "down";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);
const MIGRATIONS_TABLE = "pgmigrations";

interface MigrateOptions {
  databaseUrl: string;
  direction?: MigrationDirection;
  /** Number of migrations to apply. Defaults to all for `up` and one for `down`. */
  count?: number;
  log?: (message: string) => void;
}

/**
 * Applies the SQL migrations in `backend/migrations`. All pending migrations
 * run in one transaction, so a failing migration leaves the schema untouched.
 * Returns the names of the migrations that were run.
 */
export async function runMigrations({
  databaseUrl,
  direction = "up",
  count,
  log = () => {},
}: MigrateOptions): Promise<string[]> {
  const migrations = await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    migrationsTable: MIGRATIONS_TABLE,
    direction,
    count: count ?? (direction === "up" ? Infinity : 1),
    singleTransaction: true,
    checkOrder: true,
    log,
  });

  return migrations.map((migration) => migration.name);
}
