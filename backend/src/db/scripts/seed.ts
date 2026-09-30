import { databaseNameFromUrl } from "../../config/databaseName.js";
import { env } from "../../config/env.js";
import { pool } from "../pool.js";
import { seedDatabase } from "../seed/seed.js";
import { DEMO_PASSWORD, SEED_CUSTOMERS } from "../seed/seedData.js";

/** CLI entry point: `npm run db:seed`. */
async function main(): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data when NODE_ENV=production");
  }

  console.log(`Seeding "${databaseNameFromUrl(env.DATABASE_URL)}"...`);
  const { customersCreated, accountsCreated } = await seedDatabase();

  console.log(`Created ${customersCreated} customer(s) and ${accountsCreated} account(s).`);
  if (customersCreated === 0 && accountsCreated === 0) {
    console.log("Demo data was already present; nothing changed.");
  }
  console.log(`Demo logins: ${SEED_CUSTOMERS.map((c) => c.email).join(", ")}`);
  console.log(`Demo password: ${DEMO_PASSWORD}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
