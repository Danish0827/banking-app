import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../src/db/pool.js";
import { assertTestDatabase, resetDatabase } from "../helpers/database.js";

/** A connection that reports being attached to the given database. */
function connectionTo(databaseName: string) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("current_database()")) return { rows: [{ name: databaseName }] };
    return { rows: [] };
  });
  return { db: { query } as unknown as Queryable, query };
}

describe("test database guard", () => {
  it.each(["bank_dev", "postgres", "bank_test_backup"])(
    "refuses to truncate %j and never issues the TRUNCATE",
    async (name) => {
      const { db, query } = connectionTo(name);

      await expect(resetDatabase(db)).rejects.toThrow(/Refusing to modify database/);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls.flat().join(" ")).not.toMatch(/TRUNCATE/i);
    },
  );

  it("allows a database whose name ends in _test", async () => {
    const { db, query } = connectionTo("bank_test");

    await expect(assertTestDatabase(db)).resolves.toBeUndefined();
    await resetDatabase(db);

    expect(query.mock.calls.flat().join(" ")).toMatch(/TRUNCATE/);
  });
});
