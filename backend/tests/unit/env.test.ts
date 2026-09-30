import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EXAMPLE_SECRET = "local-development-only-secret-change-me";
const STRONG_SECRET = "k".repeat(48);

/** Loads config/env.ts from scratch with the given environment overrides. */
async function loadEnv(overrides: Record<string, string>) {
  for (const [name, value] of Object.entries(overrides)) {
    vi.stubEnv(name, value);
  }
  vi.resetModules();
  return (await import("../../src/config/env.js")).env;
}

describe("environment configuration", () => {
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

  describe("SESSION_SECRET", () => {
    it("is accepted when it is long enough", async () => {
      const env = await loadEnv({ SESSION_SECRET: STRONG_SECRET });

      expect(env.SESSION_SECRET).toBe(STRONG_SECRET);
    });

    it("has no default: the process refuses to start without it", async () => {
      await expect(loadEnv({ SESSION_SECRET: "" })).rejects.toThrow("process.exit called");
      expect(errors.join("\n")).toContain("SESSION_SECRET");
    });

    it("must be at least 32 characters", async () => {
      await expect(loadEnv({ SESSION_SECRET: "k".repeat(31) })).rejects.toThrow(
        "process.exit called",
      );
      expect(errors.join("\n")).toMatch(/SESSION_SECRET/);
    });

    it("does not print the rejected value", async () => {
      await expect(loadEnv({ SESSION_SECRET: "too-short-secret" })).rejects.toThrow();
      expect(errors.join("\n")).not.toContain("too-short-secret");
    });

    it("allows the .env.example placeholder for local development", async () => {
      const env = await loadEnv({
        NODE_ENV: "development",
        DATABASE_URL: "postgres://user:pass@localhost:5432/bank_dev",
        SESSION_SECRET: EXAMPLE_SECRET,
      });

      expect(env.SESSION_SECRET).toBe(EXAMPLE_SECRET);
    });

    it("refuses the .env.example placeholder in production", async () => {
      await expect(
        loadEnv({
          NODE_ENV: "production",
          DATABASE_URL: "postgres://user:pass@localhost:5432/bank_prod",
          SESSION_SECRET: EXAMPLE_SECRET,
        }),
      ).rejects.toThrow("process.exit called");
      expect(errors.join("\n")).toMatch(/SESSION_SECRET[\s\S]*placeholder|placeholder/);
    });
  });

  describe("SESSION_TTL_MINUTES", () => {
    it("defaults to 60 minutes", async () => {
      const env = await loadEnv({ SESSION_SECRET: STRONG_SECRET });

      expect(env.SESSION_TTL_SECONDS).toBe(3600);
    });

    it("can be configured", async () => {
      const env = await loadEnv({ SESSION_SECRET: STRONG_SECRET, SESSION_TTL_MINUTES: "15" });

      expect(env.SESSION_TTL_SECONDS).toBe(900);
    });
  });
});
