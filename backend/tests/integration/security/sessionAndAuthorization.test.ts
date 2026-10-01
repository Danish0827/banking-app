import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { createSessionToken } from "../../../src/modules/auth/session.js";
import { cookieHeader } from "../../helpers/auth.js";
import { resetDatabase } from "../../helpers/database.js";
import { activity, getHistory } from "../../helpers/history.js";
import {
  balanceOf,
  countRows,
  createCustomerWithAccount,
  type TestCustomer,
} from "../../helpers/money.js";

describe("session and authorization hardening", () => {
  const app = createApp();
  let alice: TestCustomer;
  let bob: TestCustomer;
  let bobTransactionId: string;

  beforeAll(async () => {
    await resetDatabase();
    alice = await createCustomerWithAccount(10_000);
    bob = await createCustomerWithAccount(10_000);
    bobTransactionId = await activity.deposit(bob.customerId, bob.accountId, 4_321);
  });

  /**
   * Every authenticated endpoint, as (method, path, body), acting on the given
   * account; transfers go to `destinationId`.
   */
  const protectedEndpoints = (accountId: string, destinationId = bob.accountId) =>
    [
      ["get", "/api/v1/auth/me", undefined],
      ["get", "/api/v1/accounts", undefined],
      ["get", `/api/v1/accounts/${accountId}`, undefined],
      ["post", `/api/v1/accounts/${accountId}/deposits`, { amount: 100 }],
      ["post", `/api/v1/accounts/${accountId}/withdrawals`, { amount: 100 }],
      [
        "post",
        `/api/v1/accounts/${accountId}/transfers`,
        { destinationAccountId: destinationId, amount: 100 },
      ],
      ["get", "/api/v1/transactions", undefined],
    ] as const;

  function call(method: "get" | "post", path: string, body: object | undefined, cookie: string) {
    const req = request(app)[method](path).set("Cookie", cookie);
    if (method === "post") req.set("Idempotency-Key", randomUUID());
    return body ? req.send(body) : req;
  }

  async function forgedTokens() {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const valid = await createSessionToken(alice.customerId);
    const [header, , signature] = valid.split(".");

    return {
      "a session for a customer that does not exist": await createSessionToken(randomUUID()),
      "an expired session": await createSessionToken(alice.customerId, -1),
      "a session with a swapped customer id": `${header}.${encode({
        iss: "banking-app",
        sub: bob.customerId,
        iat: now,
        exp: now + 3600,
      })}.${signature}`,
      "an unsigned (alg: none) session": `${encode({ alg: "none" })}.${encode({
        iss: "banking-app",
        sub: alice.customerId,
        iat: now,
        exp: now + 3600,
      })}.`,
      "a session from another issuer": await new SignJWT()
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("some-other-app")
        .setSubject(alice.customerId)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(new TextEncoder().encode("test-only-session-secret-0123456789abcdef")),
      "a session signed with another key": await new SignJWT()
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("banking-app")
        .setSubject(alice.customerId)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(new TextEncoder().encode("an-attacker-chosen-secret-of-good-length")),
    };
  }

  it("rejects every forged, expired or orphaned session on every protected endpoint", async () => {
    const before = {
      alice: await balanceOf(alice.accountId),
      bob: await balanceOf(bob.accountId),
      transactions: await countRows("transactions"),
    };

    for (const [label, token] of Object.entries(await forgedTokens())) {
      for (const [method, path, body] of protectedEndpoints(alice.accountId)) {
        const res = await call(method, path, body, cookieHeader(token));
        expect([label, path, res.status, res.body.error?.code]).toEqual([
          label,
          path,
          401,
          "UNAUTHENTICATED",
        ]);
      }
    }

    expect({
      alice: await balanceOf(alice.accountId),
      bob: await balanceOf(bob.accountId),
      transactions: await countRows("transactions"),
    }).toEqual(before);
  });

  describe("cross-customer access", () => {
    it("treats Bob's account as non-existent for Alice on every account endpoint", async () => {
      const before = await balanceOf(bob.accountId);

      for (const [method, path, body] of protectedEndpoints(bob.accountId, alice.accountId).slice(
        2,
        6,
      )) {
        const res = await call(method, path, body, alice.cookie);
        expect([path, res.status, res.body.error.code]).toEqual([path, 404, "ACCOUNT_NOT_FOUND"]);
      }

      expect(await balanceOf(bob.accountId)).toBe(before);
    });

    it("never takes the customer from the request", async () => {
      // Query string: ignored by the accounts list, rejected by history.
      const accounts = await request(app)
        .get(`/api/v1/accounts?customerId=${bob.customerId}`)
        .set("Cookie", alice.cookie);
      expect(accounts.body.data.accounts.map((a: { id: string }) => a.id)).toEqual([
        alice.accountId,
      ]);

      const history = await getHistory(app, alice.cookie, { customerId: bob.customerId });
      expect(history.status).toBe(400);

      // Body: rejected by every money movement.
      for (const [, path, body] of protectedEndpoints(alice.accountId).slice(3, 6)) {
        const res = await call("post", path, { ...body, customerId: bob.customerId }, alice.cookie);
        expect([path, res.status]).toEqual([path, 400]);
      }
    });

    it("does not reveal another customer's transactions by account or transaction id", async () => {
      const byAccount = await getHistory(app, alice.cookie, { accountId: bob.accountId });
      const everything = await getHistory(app, alice.cookie, { limit: "100" });

      expect(byAccount.body.data.transactions).toEqual([]);
      expect(JSON.stringify(everything.body)).not.toContain(bobTransactionId);
      // There is no endpoint that looks a transaction up by id.
      const byId = await request(app)
        .get(`/api/v1/transactions/${bobTransactionId}`)
        .set("Cookie", alice.cookie);
      expect(byId.status).toBe(404);
      expect(byId.text).not.toContain("4321");
    });
  });
});
