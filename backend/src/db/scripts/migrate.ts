import { databaseNameFromUrl } from "../../config/databaseName.js";
import { env } from "../../config/env.js";
import { runMigrations } from "../migrate.js";

/**
 * CLI entry point: `npm run db:migrate` / `npm run db:migrate:down`.
 * Targets the database selected by the environment (see config/env.ts).
 */
async function main(): Promise<void> {
  const direction = process.argv[2] ?? "up";
  if (direction !== "up" && direction !== "down") {
    throw new Error(`Unknown migration direction "${direction}" (expected "up" or "down")`);
  }

  const database = databaseNameFromUrl(env.DATABASE_URL);
  console.log(`Migrating "${database}" ${direction}...`);

  const applied = await runMigrations({
    databaseUrl: env.DATABASE_URL,
    direction,
    log: console.log,
  });

  console.log(
    applied.length === 0
      ? "No migrations to run."
      : `Done: ${applied.length} migration(s) ${direction === "up" ? "applied" : "reverted"}.`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
