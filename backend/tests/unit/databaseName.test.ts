import { describe, expect, it } from "vitest";
import { databaseNameFromUrl, isTestDatabaseName } from "../../src/config/databaseName.js";

describe("databaseNameFromUrl", () => {
  it("extracts the database name from a connection string", () => {
    expect(databaseNameFromUrl("postgres://bank:bank@localhost:5432/bank_dev")).toBe("bank_dev");
    expect(databaseNameFromUrl("postgresql://u:p@db.internal/bank_test?sslmode=require")).toBe(
      "bank_test",
    );
  });
});

describe("isTestDatabaseName", () => {
  it("accepts names ending in _test", () => {
    expect(isTestDatabaseName("bank_test")).toBe(true);
  });

  it.each(["bank_dev", "bank", "postgres", "bank_test_backup", "test", "_test", ""])(
    "rejects %j",
    (name) => {
      expect(isTestDatabaseName(name)).toBe(false);
    },
  );
});
