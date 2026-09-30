import "dotenv/config";
import { z } from "zod";
import { databaseNameFromUrl, isTestDatabaseName } from "./databaseName.js";

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** The value shipped in .env.example. Fine for local use, refused in production. */
const EXAMPLE_SESSION_SECRET = "local-development-only-secret-change-me";

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
    // Signs session tokens. Required in every environment; there is no default.
    SESSION_SECRET: z
      .string({ error: "Required" })
      .min(32, { error: "Must be at least 32 characters" }),
    SESSION_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .default(60),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && value.SESSION_SECRET === EXAMPLE_SESSION_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message: "Must not be the placeholder from .env.example in production",
      });
    }

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
  SESSION_SECRET: string;
  SESSION_TTL_SECONDS: number;
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast: a misconfigured process should never start serving requests.
    console.error("Invalid environment configuration:\n" + z.prettifyError(parsed.error));
    process.exit(1);
  }

  const { NODE_ENV, DATABASE_URL, TEST_DATABASE_URL } = parsed.data;
  const databaseUrl = NODE_ENV === "test" ? TEST_DATABASE_URL : DATABASE_URL;

  return {
    NODE_ENV,
    PORT: parsed.data.PORT,
    LOG_LEVEL: parsed.data.LOG_LEVEL,
    // The schema refinement above guarantees the active URL is present.
    DATABASE_URL: databaseUrl as string,
    DB_POOL_MAX: parsed.data.DB_POOL_MAX,
    SESSION_SECRET: parsed.data.SESSION_SECRET,
    SESSION_TTL_SECONDS: parsed.data.SESSION_TTL_MINUTES * 60,
  };
}

export const env = loadEnv();
