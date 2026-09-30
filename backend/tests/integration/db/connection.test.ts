import { describe, expect, it } from "vitest";
import { databaseNameFromUrl, isTestDatabaseName } from "../../../src/config/databaseName.js";
import { env } from "../../../src/config/env.js";
import { checkDatabaseConnection, pool } from "../../../src/db/pool.js";

describe("database connection", () => {
  it("connects and runs a query", async () => {
    await expect(checkDatabaseConnection()).resolves.toBeUndefined();

    const { rows } = await pool.query<{ answer: number }>("SELECT 1 + 1 AS answer");
    expect(rows[0]?.answer).toBe(2);
  });

  it("uses TEST_DATABASE_URL, not DATABASE_URL, under NODE_ENV=test", () => {
    expect(env.NODE_ENV).toBe("test");
    expect(env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
    expect(env.DATABASE_URL).not.toBe(process.env.DATABASE_URL);
  });

  it("is attached to a dedicated test database", async () => {
    const { rows } = await pool.query<{ name: string }>("SELECT current_database() AS name");
    const name = rows[0]?.name ?? "";

    expect(isTestDatabaseName(name)).toBe(true);
    expect(name).toBe(databaseNameFromUrl(env.DATABASE_URL));
  });
});

describe("BIGINT handling", () => {
  it("returns BIGINT values as numbers", async () => {
    const { rows } = await pool.query<{ cents: unknown }>("SELECT 1234567890123::bigint AS cents");

    expect(rows[0]?.cents).toBe(1_234_567_890_123);
  });

  it("round-trips a number parameter through a BIGINT column type", async () => {
    const { rows } = await pool.query<{ cents: unknown }>("SELECT $1::bigint AS cents", [250_000]);

    expect(rows[0]?.cents).toBe(250_000);
  });

  it("rejects the query rather than returning an imprecise number", async () => {
    await expect(pool.query("SELECT 9007199254740993::bigint AS cents")).rejects.toThrow(
      /outside the safe integer range/,
    );
  });
});
