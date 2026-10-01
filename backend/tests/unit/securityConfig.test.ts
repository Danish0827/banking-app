import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Loads config/env.ts from scratch with the given environment overrides. */
async function loadEnv(overrides: Record<string, string>) {
  for (const [name, value] of Object.entries(overrides)) {
    vi.stubEnv(name, value);
  }
  vi.resetModules();
  return (await import("../../src/config/env.js")).env;
}

describe("security configuration", () => {
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

  describe("CORS_ALLOWED_ORIGINS", () => {
    it("defaults to no trusted origins", async () => {
      const env = await loadEnv({ CORS_ALLOWED_ORIGINS: "" });

      expect(env.CORS_ALLOWED_ORIGINS).toEqual([]);
    });

    it("accepts a comma-separated list of exact origins", async () => {
      const env = await loadEnv({
        CORS_ALLOWED_ORIGINS: "https://app.example.com, http://localhost:3000",
      });

      expect(env.CORS_ALLOWED_ORIGINS).toEqual([
        "https://app.example.com",
        "http://localhost:3000",
      ]);
    });

    it.each([
      ["a wildcard", "*"],
      ["a wildcard subdomain", "https://*.example.com"],
      ["an origin with a path", "https://app.example.com/"],
      ["an origin with a path segment", "https://app.example.com/app"],
      ["a bare host", "app.example.com"],
      ["a non-web scheme", "file:///tmp"],
    ])("refuses to start with %s", async (_label, value) => {
      await expect(loadEnv({ CORS_ALLOWED_ORIGINS: value })).rejects.toThrow("process.exit called");
      expect(errors.join("\n")).toContain("CORS_ALLOWED_ORIGINS");
    });
  });

  describe("MONEY_RATE_LIMIT_PER_MINUTE", () => {
    it("defaults to 30 per minute", async () => {
      vi.stubEnv("MONEY_RATE_LIMIT_PER_MINUTE", undefined);
      const env = await loadEnv({});

      expect(env.MONEY_RATE_LIMIT_PER_MINUTE).toBe(30);
    });

    it.each(["0", "-5", "abc", "1.5"])("refuses %j", async (value) => {
      await expect(loadEnv({ MONEY_RATE_LIMIT_PER_MINUTE: value })).rejects.toThrow(
        "process.exit called",
      );
    });
  });
});
