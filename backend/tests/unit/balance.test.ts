import { describe, expect, it } from "vitest";
import { credit, debit, MAX_BALANCE } from "../../src/modules/transactions/balance.js";

describe("credit", () => {
  it("adds integer cents", () => {
    expect(credit(250_000, 1_050)).toBe(251_050);
    expect(credit(0, 1)).toBe(1);
  });

  it("allows reaching the largest exact balance", () => {
    expect(credit(MAX_BALANCE - 10, 10)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("refuses to go past the largest exact balance", () => {
    expect(() => credit(MAX_BALANCE - 10, 11)).toThrow(
      expect.objectContaining({ code: "BALANCE_LIMIT_EXCEEDED", status: 422 }),
    );
  });

  it("uses a caller-supplied message", () => {
    expect(() => credit(MAX_BALANCE, 1, "Custom limit message")).toThrow("Custom limit message");
  });
});

describe("debit", () => {
  it("subtracts integer cents", () => {
    expect(debit(10_000, 2_500)).toBe(7_500);
  });

  it("allows debiting the entire balance", () => {
    expect(debit(10_000, 10_000)).toBe(0);
  });

  it.each([
    [10_000, 10_001],
    [0, 1],
  ])("refuses to take %d below zero by debiting %d", (balance, amount) => {
    expect(() => debit(balance, amount)).toThrow(
      expect.objectContaining({ code: "INSUFFICIENT_FUNDS", status: 422 }),
    );
  });

  it("uses a caller-supplied message", () => {
    expect(() => debit(0, 1, "Insufficient funds for this transfer")).toThrow(
      "Insufficient funds for this transfer",
    );
  });
});
