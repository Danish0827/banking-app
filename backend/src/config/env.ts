import "dotenv/config";
import { z } from "zod";
import { databaseNameFromUrl, isTestDatabaseName } from "./databaseName.js";

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: postgresUrl.optional(),
    TEST_DATABASE_URL: postgresUrl.optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "test") {
      if (!value.DATABASE_URL) {
        ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "Required" });
      }
      return;
    }

    if (!value.TEST_DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["TEST_DATABASE_URL"],
        message: "Required when NODE_ENV=test",
      });
    } else if (!isTestDatabaseName(databaseNameFromUrl(value.TEST_DATABASE_URL))) {
      ctx.addIssue({
        code: "custom",
        path: ["TEST_DATABASE_URL"],
        message: 'Must point at a database whose name ends in "_test"',
      });
    }
  });

type ParsedEnv = z.infer<typeof envSchema>;

export interface Env {
  NODE_ENV: ParsedEnv["NODE_ENV"];
  PORT: number;
  LOG_LEVEL: ParsedEnv["LOG_LEVEL"];
  /**
   * The database this process talks to. Under NODE_ENV=test this is always
   * TEST_DATABASE_URL, so a test run can never reach the development database
   * even when DATABASE_URL is also set.
   */
  DATABASE_URL: string;
  DB_POOL_MAX: number;
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast: a misconfigured process should never start serving requests.
    console.error("Invalid environment configuration:\n" + z.prettifyError(parsed.error));
    process.exit(1);
  }

  const { NODE_ENV, PORT, LOG_LEVEL, DB_POOL_MAX, DATABASE_URL, TEST_DATABASE_URL } = parsed.data;
  const databaseUrl = NODE_ENV === "test" ? TEST_DATABASE_URL : DATABASE_URL;

  // The schema refinement above guarantees the active URL is present.
  return { NODE_ENV, PORT, LOG_LEVEL, DB_POOL_MAX, DATABASE_URL: databaseUrl as string };
}

export const env = loadEnv();
