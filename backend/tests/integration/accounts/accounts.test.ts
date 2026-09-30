import type { Express } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { seedDatabase } from "../../../src/db/seed/seed.js";
import { SEED_CUSTOMERS, type SeedCustomer } from "../../../src/db/seed/seedData.js";
import { createSessionToken } from "../../../src/modules/auth/session.js";
import { ALICE, BOB, cookieHeader } from "../../helpers/auth.js";
import { resetDatabase } from "../../helpers/database.js";
import { createCustomer } from "../../helpers/fixtures.js";

const CAROL = SEED_CUSTOMERS[2] as SeedCustomer;
const UNKNOWN_ACCOUNT_ID = "00000000-0000-4000-8000-00000000dead";
const ACCOUNT_FIELDS = ["accountNumber", "balance", "createdAt", "currency", "id", "type"];

/** The API representation expected for a customer's seeded accounts. */
function expectedAccounts(customer: SeedCustomer) {
  return customer.accounts.map((account) => ({
    id: account.id,
    accountNumber: account.accountNumber,
    type: account.type,
    currency: "USD",
    balance: account.openingBalance,
    createdAt: expect.any(String),
  }));
}

describe("accounts", () => {
  let app: Express;
  let aliceCookie: string;
  let bobCookie: string;
  let carolCookie: string;

  const get = (path: string, cookie?: string) => {
    const req = request(app).get(`/api/v1${path}`);
    return cookie ? req.set("Cookie", cookie) : req;
  };

  beforeAll(async () => {
    await resetDatabase();
    await seedDatabase({ bcryptRounds: 4 });
    app = createApp();

    aliceCookie = cookieHeader(await createSessionToken(ALICE.id));
    bobCookie = cookieHeader(await createSessionToken(BOB.id));
    carolCookie = cookieHeader(await createSessionToken(CAROL.id));
  });

  describe("authentication", () => {
    const expectUnauthenticated = (res: request.Response) => {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required",
          requestId: expect.any(String),
        },
      });
    };

    it("GET /accounts returns 401 without a session", async () => {
      expectUnauthenticated(await get("/accounts"));
    });

    it("GET /accounts/:accountId returns 401 without a session", async () => {
      expectUnauthenticated(await get(`/accounts/${ALICE.accounts[0]?.id}`));
    });

    it("returns 401 for an invalid session", async () => {
      expectUnauthenticated(await get("/accounts", cookieHeader("not-a-valid-token")));
      expectUnauthenticated(
        await get(`/accounts/${ALICE.accounts[0]?.id}`, cookieHeader("not-a-valid-token")),
      );
    });

    it("checks authentication before validating the account id", async () => {
      expectUnauthenticated(await get("/accounts/not-a-uuid"));
    });
  });

  describe("GET /api/v1/accounts", () => {
    it("returns the authenticated customer's accounts", async () => {
      const res = await get("/accounts", aliceCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { accounts: expectedAccounts(ALICE) } });
    });

    it("returns only that customer's accounts, never anyone else's", async () => {
      const res = await get("/accounts", bobCookie);

      expect(res.body.data.accounts).toEqual(expectedAccounts(BOB));

      const returnedIds = res.body.data.accounts.map((account: { id: string }) => account.id);
      const otherIds = [...ALICE.accounts, ...CAROL.accounts].map((account) => account.id);
      expect(returnedIds.filter((id: string) => otherIds.includes(id))).toEqual([]);
    });

    it("orders accounts by account number", async () => {
      const res = await get("/accounts", carolCookie);

      const numbers = res.body.data.accounts.map(
        (account: { accountNumber: string }) => account.accountNumber,
      );
      expect(numbers).toEqual(["1000000004", "1000000005"]);
    });

    it("ignores a customer id supplied by the client", async () => {
      const res = await get(`/accounts?customerId=${BOB.id}&customer_id=${BOB.id}`, aliceCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.accounts).toEqual(expectedAccounts(ALICE));
    });

    it("returns an empty list for a customer with no accounts", async () => {
      const customerId = await createCustomer();
      const cookie = cookieHeader(await createSessionToken(customerId));

      const res = await get("/accounts", cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { accounts: [] } });
    });
  });

  describe("GET /api/v1/accounts/:accountId", () => {
    const aliceAccount = ALICE.accounts[0];
    const bobAccount = BOB.accounts[0];

    const expectNotFound = (res: request.Response) => {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: {
          code: "ACCOUNT_NOT_FOUND",
          message: "Account not found",
          requestId: expect.any(String),
        },
      });
    };

    it("returns an account to its owner", async () => {
      const res = await get(`/accounts/${aliceAccount?.id}`, aliceCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { account: expectedAccounts(ALICE)[0] } });
    });

    it("does not let Alice retrieve Bob's account", async () => {
      expectNotFound(await get(`/accounts/${bobAccount?.id}`, aliceCookie));
    });

    it("does not let Bob retrieve Alice's account", async () => {
      for (const account of ALICE.accounts) {
        expectNotFound(await get(`/accounts/${account.id}`, bobCookie));
      }
    });

    it("returns 404 for an account that does not exist", async () => {
      expectNotFound(await get(`/accounts/${UNKNOWN_ACCOUNT_ID}`, aliceCookie));
    });

    it("answers identically for someone else's account and a non-existent one", async () => {
      const someoneElses = await get(`/accounts/${bobAccount?.id}`, aliceCookie);
      const nonExistent = await get(`/accounts/${UNKNOWN_ACCOUNT_ID}`, aliceCookie);

      expect(someoneElses.status).toBe(nonExistent.status);
      expect({ ...someoneElses.body.error, requestId: null }).toEqual({
        ...nonExistent.body.error,
        requestId: null,
      });
    });

    it("ignores a customer id supplied by the client", async () => {
      expectNotFound(await get(`/accounts/${bobAccount?.id}?customerId=${BOB.id}`, aliceCookie));
    });

    it.each([
      ["a non-UUID string", "not-a-uuid"],
      ["a number", "12345"],
      ["an account number", "1000000003"],
      ["a truncated UUID", "00000000-0000-4000-8000-0000000001"],
      ["an SQL injection attempt", "1' OR '1'='1"],
    ])("rejects %s as the account id with 400", async (_label, accountId) => {
      const res = await get(`/accounts/${encodeURIComponent(accountId)}`, aliceCookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: [{ path: "accountId", message: "Invalid account id" }],
        requestId: expect.any(String),
      });
    });
  });

  describe("data representation", () => {
    it("returns balances as integer minor units (cents)", async () => {
      const res = await get("/accounts", aliceCookie);

      for (const account of res.body.data.accounts as { balance: unknown }[]) {
        expect(typeof account.balance).toBe("number");
        expect(Number.isInteger(account.balance)).toBe(true);
      }
      // $2,500.00 and $10,000.00
      expect(res.body.data.accounts.map((a: { balance: number }) => a.balance)).toEqual([
        250_000, 1_000_000,
      ]);
      // The raw JSON carries a bare integer: not a string, not a decimal.
      expect(res.text).toContain('"balance":250000,');
    });

    it("represents a zero balance as 0", async () => {
      const res = await get(`/accounts/${CAROL.accounts[1]?.id}`, carolCookie);

      expect(res.body.data.account.balance).toBe(0);
    });

    it("preserves large balances exactly", async () => {
      const account = BOB.accounts[0];
      const large = 123_456_789_012_345;
      await pool.query("UPDATE accounts SET balance = $1 WHERE id = $2", [large, account?.id]);

      try {
        const res = await get(`/accounts/${account?.id}`, bobCookie);

        expect(res.body.data.account.balance).toBe(large);
      } finally {
        await pool.query("UPDATE accounts SET balance = $1 WHERE id = $2", [
          account?.openingBalance,
          account?.id,
        ]);
      }
    });

    it("exposes only the public account fields", async () => {
      const list = await get("/accounts", aliceCookie);
      const detail = await get(`/accounts/${ALICE.accounts[0]?.id}`, aliceCookie);

      for (const account of [...list.body.data.accounts, detail.body.data.account]) {
        expect(Object.keys(account).sort()).toEqual(ACCOUNT_FIELDS);
      }
    });

    it("never returns customer ids, password hashes or other internal fields", async () => {
      const responses = [
        await get("/accounts", aliceCookie),
        await get(`/accounts/${ALICE.accounts[0]?.id}`, aliceCookie),
        await get(`/accounts/${BOB.accounts[0]?.id}`, aliceCookie),
      ];

      for (const res of responses) {
        expect(res.text).not.toMatch(/password|customer_?id|updated_?at|\$2b\$/i);
        expect(res.text).not.toContain(ALICE.id);
        expect(res.text).not.toContain(BOB.id);
      }
    });

    it("tells caches not to store account data", async () => {
      const res = await get("/accounts", aliceCookie);

      expect(res.headers["cache-control"]).toBe("no-store");
    });
  });
});
