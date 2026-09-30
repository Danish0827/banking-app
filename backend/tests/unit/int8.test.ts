import { describe, expect, it } from "vitest";
import { parseInt8 } from "../../src/db/int8.js";

describe("parseInt8", () => {
  it("parses BIGINT strings into numbers", () => {
    expect(parseInt8("0")).toBe(0);
    expect(parseInt8("250000")).toBe(250_000);
    expect(parseInt8("-42")).toBe(-42);
  });

  it("accepts the largest safe integer", () => {
    expect(parseInt8("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("throws instead of losing precision beyond the safe integer range", () => {
    expect(() => parseInt8("9007199254740992")).toThrow(RangeError);
    expect(() => parseInt8("9223372036854775807")).toThrow(RangeError);
    expect(() => parseInt8("-9007199254740992")).toThrow(RangeError);
  });
});
