import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STRONG_SECRET = "Zk3-pQ9_xW2vB7nM4tR8yL1cF6hJ0aS5dG";
const PRODUCTION = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://user:pass@db.internal:5432/bank_prod",
  SESSION_SECRET: STRONG_SECRET,
};

/** Loads config/env.ts from scratch with the given environment overrides. */
async function loadEnv(overrides: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(overrides)) {
    vi.stubEnv(name, value);
  }
  vi.resetModules();
  return (await import("../../src/config/env.js")).env;
}

describe("operational configuration", () => {
  let errors: string[];

  beforeEach(() => {
    errors = [];
    vi.spyOn(console, "error").mockImplementation((message: string) => {
      errors.push(message);
    });
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("database pool and shutdown settings", () => {
    it("have production-safe defaults", async () => {
      const env = await loadEnv({
        DB_POOL_MAX: undefined,
        DB_CONNECTION_TIMEOUT_MS: undefined,
        DB_IDLE_TIMEOUT_MS: undefined,
        DB_STATEMENT_TIMEOUT_MS: undefined,
        SHUTDOWN_TIMEOUT_MS: undefined,
      });

      expect({
        pool: env.DB_POOL_MAX,
        connection: env.DB_CONNECTION_TIMEOUT_MS,
        idle: env.DB_IDLE_TIMEOUT_MS,
        statement: env.DB_STATEMENT_TIMEOUT_MS,
        shutdown: env.SHUTDOWN_TIMEOUT_MS,
      }).toEqual({
        pool: 10,
        connection: 5_000,
        idle: 30_000,
        statement: 10_000,
        shutdown: 10_000,
      });
    });

    it("are applied to the connection pool", async () => {
      await loadEnv({
        DB_POOL_MAX: "4",
        DB_CONNECTION_TIMEOUT_MS: "1500",
        DB_IDLE_TIMEOUT_MS: "20000",
        DB_STATEMENT_TIMEOUT_MS: "7000",
      });
      const { createPool } = await import("../../src/db/pool.js");
      const pool = createPool("postgres://user:pass@localhost:5432/bank_test");

      try {
        expect(pool.options).toMatchObject({
          max: 4,
          connectionTimeoutMillis: 1_500,
          idleTimeoutMillis: 20_000,
          statement_timeout: 7_000,
          idle_in_transaction_session_timeout: 7_000,
        });
      } finally {
        await pool.end();
      }
    });

    it.each([
      ["DB_POOL_MAX", "0"],
      ["DB_POOL_MAX", "500"],
      ["DB_CONNECTION_TIMEOUT_MS", "0"],
      ["DB_IDLE_TIMEOUT_MS", "abc"],
      ["DB_STATEMENT_TIMEOUT_MS", "-1"],
      ["SHUTDOWN_TIMEOUT_MS", "10"],
      ["SHUTDOWN_TIMEOUT_MS", "999999"],
    ])("refuses %s=%s", async (name, value) => {
      await expect(loadEnv({ [name]: value })).rejects.toThrow("process.exit called");
      expect(errors.join("\n")).toContain(name);
    });
  });

  describe("production safety", () => {
    it("starts with a complete, safe production configuration", async () => {
      const env = await loadEnv({
        ...PRODUCTION,
        CORS_ALLOWED_ORIGINS: "https://app.example.com",
      });

      expect(env.NODE_ENV).toBe("production");
    });

    it("requires DATABASE_URL", async () => {
      await expect(loadEnv({ ...PRODUCTION, DATABASE_URL: undefined })).rejects.toThrow(
        "process.exit called",
      );
      expect(errors.join("\n")).toContain("DATABASE_URL");
    });

    it("refuses a malformed DATABASE_URL without printing it", async () => {
      await expect(
        loadEnv({ ...PRODUCTION, DATABASE_URL: "mysql://admin:topsecret@db/bank" }),
      ).rejects.toThrow("process.exit called");
      expect(errors.join("\n")).toContain("DATABASE_URL");
      expect(errors.join("\n")).not.toContain("topsecret");
    });

    it.each([
      ["a missing secret", undefined],
      ["a short secret", "short"],
      ["a repetitive secret", "a".repeat(64)],
      ["a low-variety secret", "abababababababababababababababab12"],
    ])("refuses %s", async (_label, secret) => {
      await expect(loadEnv({ ...PRODUCTION, SESSION_SECRET: secret })).rejects.toThrow(
        "process.exit called",
      );
      expect(errors.join("\n")).toContain("SESSION_SECRET");
      if (secret) expect(errors.join("\n")).not.toContain(secret);
    });

    it("refuses plain-http CORS origins in production", async () => {
      await expect(
        loadEnv({ ...PRODUCTION, CORS_ALLOWED_ORIGINS: "http://app.example.com" }),
      ).rejects.toThrow("process.exit called");
      expect(errors.join("\n")).toContain("CORS_ALLOWED_ORIGINS");
    });

    it("still allows http origins and simple secrets for local development", async () => {
      const env = await loadEnv({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://bank:bank@localhost:5432/bank_dev",
        SESSION_SECRET: "a".repeat(40),
        CORS_ALLOWED_ORIGINS: "http://localhost:3000",
      });

      expect(env.CORS_ALLOWED_ORIGINS).toEqual(["http://localhost:3000"]);
    });
  });
});
