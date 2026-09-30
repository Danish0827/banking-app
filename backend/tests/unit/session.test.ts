import type { Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionCookie,
  createSessionToken,
  setSessionCookie,
  verifySessionToken,
} from "../../src/modules/auth/session.js";

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";

describe("session tokens", () => {
  it("round-trips the customer id", async () => {
    const token = await createSessionToken(CUSTOMER_ID);

    expect(await verifySessionToken(token)).toEqual({ customerId: CUSTOMER_ID });
  });

  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["a non-string", 12345],
    ["an arbitrary string", "not-a-jwt"],
  ])("rejects %s", async (_label, token) => {
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    expect(await verifySessionToken(await createSessionToken(CUSTOMER_ID, -1))).toBeNull();
  });

  it("rejects a token whose subject is not a customer id", async () => {
    expect(await verifySessionToken(await createSessionToken("not-a-uuid"))).toBeNull();
  });
});

describe("session cookie options", () => {
  const fakeResponse = () => {
    const res = { cookie: vi.fn(), clearCookie: vi.fn() };
    return res as typeof res & Response;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is not Secure outside production, so it works over local HTTP", () => {
    const res = fakeResponse();

    setSessionCookie(res, "token");

    expect(res.cookie).toHaveBeenCalledWith("session", "token", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 3_600_000,
    });
  });

  it("is Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/bank_prod");
    vi.resetModules();
    const production = await import("../../src/modules/auth/session.js");
    const res = fakeResponse();

    production.setSessionCookie(res, "token");
    production.clearSessionCookie(res);

    expect(res.cookie).toHaveBeenCalledWith(
      "session",
      "token",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", secure: true }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      "session",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", secure: true, path: "/" }),
    );
  });

  it("clears the cookie with the same attributes it was set with", () => {
    const res = fakeResponse();

    clearSessionCookie(res);

    expect(res.clearCookie).toHaveBeenCalledWith("session", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
    });
  });
});
