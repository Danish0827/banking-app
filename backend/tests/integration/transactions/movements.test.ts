import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { seedDatabase } from "../../../src/db/seed/seed.js";
import { createSessionToken } from "../../../src/modules/auth/session.js";
import { ALICE, BOB, cookieHeader } from "../../helpers/auth.js";
import { resetDatabase } from "../../helpers/database.js";
import {
  balanceOf,
  countRows,
  createCustomerWithAccount,
  expectLedgerConsistent,
  postMovement,
  recordsFor,
  type Operation,
} from "../../helpers/money.js";

const OPERATIONS: Operation[] = ["deposits", "withdrawals"];
const ALICE_CHECKING = ALICE.accounts[0]?.id as string;
const BOB_CHECKING = BOB.accounts[0]?.id as string;

describe("deposits and withdrawals", () => {
  let app: Express;
  let aliceCookie: string;

  beforeAll(async () => {
    await resetDatabase();
    await seedDatabase({ bcryptRounds: 4 });
    app = createApp();
    aliceCookie = cookieHeader(await createSessionToken(ALICE.id));
  });

  describe.each(OPERATIONS)("POST /accounts/:accountId/%s", (operation) => {
    describe("authentication", () => {
      it("returns 401 without a session and moves no money", async () => {
        const before = await balanceOf(ALICE_CHECKING);

        const res = await postMovement(app, operation, ALICE_CHECKING, { amount: 100 });

        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("UNAUTHENTICATED");
        expect(await balanceOf(ALICE_CHECKING)).toBe(before);
      });

      it("returns 401 for an invalid session", async () => {
        const res = await postMovement(
          app,
          operation,
          ALICE_CHECKING,
          { amount: 100 },
          {
            cookie: cookieHeader("not-a-valid-token"),
          },
        );

        expect(res.status).toBe(401);
      });

      it("authenticates before validating anything else", async () => {
        const res = await postMovement(
          app,
          operation,
          "not-a-uuid",
          { amount: -1 },
          {
            idempotencyKey: null,
          },
        );

        expect(res.status).toBe(401);
      });
    });

    describe("ownership", () => {
      it("does not let Alice use Bob's account, and reveals nothing about it", async () => {
        const before = await balanceOf(BOB_CHECKING);
        const recordsBefore = await recordsFor(BOB_CHECKING);

        const res = await postMovement(
          app,
          operation,
          BOB_CHECKING,
          { amount: 100 },
          {
            cookie: aliceCookie,
          },
        );

        expect(res.status).toBe(404);
        expect(res.body.error).toEqual({
          code: "ACCOUNT_NOT_FOUND",
          message: "Account not found",
          requestId: expect.any(String),
        });
        expect(await balanceOf(BOB_CHECKING)).toBe(before);
        expect(await recordsFor(BOB_CHECKING)).toEqual(recordsBefore);
      });

      it("answers the same for a non-existent account", async () => {
        const res = await postMovement(
          app,
          operation,
          "00000000-0000-4000-8000-00000000dead",
          { amount: 100 },
          { cookie: aliceCookie },
        );

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe("ACCOUNT_NOT_FOUND");
      });

      it("rejects a customer id in the body instead of trusting it", async () => {
        const before = await balanceOf(BOB_CHECKING);

        const res = await postMovement(
          app,
          operation,
          BOB_CHECKING,
          { amount: 100, customerId: BOB.id },
          { cookie: aliceCookie },
        );

        expect([400, 404]).toContain(res.status);
        expect(await balanceOf(BOB_CHECKING)).toBe(before);
      });
    });

    describe("validation", () => {
      const expectRejected = async (body: unknown, path: string) => {
        const transactionsBefore = await countRows("transactions");
        const balanceBefore = await balanceOf(ALICE_CHECKING);

        const res = await postMovement(app, operation, ALICE_CHECKING, body, {
          cookie: aliceCookie,
        });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
        expect(await countRows("transactions")).toBe(transactionsBefore);
        expect(await balanceOf(ALICE_CHECKING)).toBe(balanceBefore);
      };

      it.each([
        ["zero", 0],
        ["a negative amount", -100],
        ["a decimal amount", 10.5],
        ["a tiny fraction", 0.01],
        ["a numeric string", "1000"],
        ["a decimal string", "10.50"],
        ["null", null],
        ["a boolean", true],
        ["one cent over the maximum", 100_000_001],
        ["an unsafe integer", Number.MAX_SAFE_INTEGER + 2],
        ["an exponent beyond the maximum", 1e21],
      ])("rejects %s as the amount", async (_label, amount) => {
        await expectRejected({ amount }, "amount");
      });

      it("rejects a missing amount", async () => {
        await expectRejected({}, "amount");
      });

      it("rejects unexpected fields", async () => {
        await expectRejected({ amount: 100, accountId: BOB_CHECKING }, "");
      });

      it("rejects an invalid account id", async () => {
        const res = await postMovement(
          app,
          operation,
          "not-a-uuid",
          { amount: 100 },
          {
            cookie: aliceCookie,
          },
        );

        expect(res.status).toBe(400);
        expect(res.body.error.details).toEqual([
          { path: "accountId", message: "Invalid account id" },
        ]);
      });

      it.each([
        ["missing", null, "Idempotency-Key header is required"],
        ["empty", "", "Idempotency-Key must be 1-255 visible ASCII characters"],
        ["too long", "k".repeat(256), "Idempotency-Key must be 1-255 visible ASCII characters"],
        [
          "containing spaces",
          "has a space",
          "Idempotency-Key must be 1-255 visible ASCII characters",
        ],
      ])("rejects a %s Idempotency-Key", async (_label, idempotencyKey, message) => {
        const before = await countRows("transactions");

        const res = await postMovement(
          app,
          operation,
          ALICE_CHECKING,
          { amount: 100 },
          {
            cookie: aliceCookie,
            idempotencyKey,
          },
        );

        expect(res.status).toBe(400);
        expect(res.body.error.details).toEqual([{ path: "Idempotency-Key", message }]);
        expect(await countRows("transactions")).toBe(before);
      });
    });
  });

  describe("deposit", () => {
    it("increases the balance and returns the transaction and updated account", async () => {
      const { accountId, cookie } = await createCustomerWithAccount(0);

      const res = await postMovement(app, "deposits", accountId, { amount: 1050 }, { cookie });

      expect(res.status).toBe(201);
      expect(res.headers["idempotent-replayed"]).toBeUndefined();
      expect(res.body).toEqual({
        data: {
          transaction: {
            id: expect.any(String),
            type: "deposit",
            accountId,
            amount: 1050,
            currency: "USD",
            balanceAfter: 1050,
            createdAt: expect.any(String),
          },
          account: {
            id: accountId,
            accountNumber: expect.any(String),
            type: "checking",
            currency: "USD",
            balance: 1050,
            createdAt: expect.any(String),
          },
        },
      });
      expect(await balanceOf(accountId)).toBe(1050);
    });

    it("records one deposit transaction and one credit ledger entry", async () => {
      const { customerId, accountId, cookie } = await createCustomerWithAccount(0);

      const res = await postMovement(
        app,
        "deposits",
        accountId,
        { amount: 2500 },
        {
          cookie,
          idempotencyKey: "deposit-key-1",
        },
      );

      const { rows } = await pool.query(
        `SELECT type, amount, currency, source_account_id, destination_account_id,
                initiated_by, idempotency_key
         FROM transactions WHERE id = $1`,
        [res.body.data.transaction.id],
      );
      expect(rows).toEqual([
        {
          type: "deposit",
          amount: 2500,
          currency: "USD",
          source_account_id: null,
          destination_account_id: accountId,
          initiated_by: customerId,
          idempotency_key: "deposit-key-1",
        },
      ]);
      expect((await recordsFor(accountId)).entries).toEqual([
        {
          transaction_id: res.body.data.transaction.id,
          direction: "credit",
          amount: 2500,
          balance_after: 2500,
        },
      ]);
    });

    it("adds successive deposits exactly, in integer cents", async () => {
      const { accountId, cookie } = await createCustomerWithAccount(0);

      for (const amount of [1, 10, 99, 1050, 100_000_000]) {
        await postMovement(app, "deposits", accountId, { amount }, { cookie });
      }

      const res = await postMovement(app, "deposits", accountId, { amount: 1 }, { cookie });
      expect(res.body.data.account.balance).toBe(100_001_161);
      expect(Number.isInteger(res.body.data.account.balance)).toBe(true);
      expect(res.text).toContain('"balance":100001161');
      await expectLedgerConsistent(accountId);
    });

    it("refuses a deposit that would exceed the largest exact balance", async () => {
      const { accountId, cookie } = await createCustomerWithAccount(0);
      await pool.query("UPDATE accounts SET balance = $1 WHERE id = $2", [
        Number.MAX_SAFE_INTEGER - 10,
        accountId,
      ]);

      const tooMuch = await postMovement(app, "deposits", accountId, { amount: 11 }, { cookie });
      expect(tooMuch.status).toBe(422);
      expect(tooMuch.body.error.code).toBe("BALANCE_LIMIT_EXCEEDED");
      expect(await balanceOf(accountId)).toBe(Number.MAX_SAFE_INTEGER - 10);

      const exact = await postMovement(app, "deposits", accountId, { amount: 10 }, { cookie });
      expect(exact.status).toBe(201);
      expect(exact.body.data.account.balance).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe("withdrawal", () => {
    it("decreases the balance and returns the transaction and updated account", async () => {
      const { accountId, cookie } = await createCustomerWithAccount(10_000);

      const res = await postMovement(app, "withdrawals", accountId, { amount: 2500 }, { cookie });

      expect(res.status).toBe(201);
      expect(res.body.data.transaction).toEqual({
        id: expect.any(String),
        type: "withdrawal",
        accountId,
        amount: 2500,
        currency: "USD",
        balanceAfter: 7500,
        createdAt: expect.any(String),
      });
      expect(res.body.data.account.balance).toBe(7500);
      expect(await balanceOf(accountId)).toBe(7500);
    });

    it("records one withdrawal transaction and one debit ledger entry", async () => {
      const { customerId, accountId, cookie } = await createCustomerWithAccount(10_000);

      const res = await postMovement(app, "withdrawals", accountId, { amount: 2500 }, { cookie });

      const { rows } = await pool.query(
        `SELECT type, amount, source_account_id, destination_account_id, initiated_by
         FROM transactions WHERE id = $1`,
        [res.body.data.transaction.id],
      );
      expect(rows).toEqual([
        {
          type: "withdrawal",
          amount: 2500,
          source_account_id: accountId,
          destination_account_id: null,
          initiated_by: customerId,
        },
      ]);
      const { entries } = await recordsFor(accountId);
      expect(entries.at(-1)).toEqual({
        transaction_id: res.body.data.transaction.id,
        direction: "debit",
        amount: 2500,
        balance_after: 7500,
      });
      await expectLedgerConsistent(accountId);
    });

    it("allows withdrawing the entire balance", async () => {
      const { accountId, cookie } = await createCustomerWithAccount(10_000);

      const res = await postMovement(
        app,
        "withdrawals",
        accountId,
        { amount: 10_000 },
        {
          cookie,
        },
      );

      expect(res.status).toBe(201);
      expect(await balanceOf(accountId)).toBe(0);
      await expectLedgerConsistent(accountId);
    });

    it.each([
      ["one cent more than the balance", 10_000, 10_001],
      ["far more than the balance", 10_000, 100_000_000],
      ["anything from an empty account", 0, 1],
    ])("rejects %s and changes nothing", async (_label, opening, amount) => {
      const { accountId, cookie } = await createCustomerWithAccount(opening);
      const recordsBefore = await recordsFor(accountId);

      const res = await postMovement(app, "withdrawals", accountId, { amount }, { cookie });

      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({
        code: "INSUFFICIENT_FUNDS",
        message: "Insufficient funds for this withdrawal",
        requestId: expect.any(String),
      });
      expect(await balanceOf(accountId)).toBe(opening);
      expect(await recordsFor(accountId)).toEqual(recordsBefore);
    });
  });

  describe("response hygiene", () => {
    it("never returns customer ids, idempotency keys or other internal fields", async () => {
      const { customerId, accountId, cookie } = await createCustomerWithAccount(0);

      const res = await postMovement(
        app,
        "deposits",
        accountId,
        { amount: 100 },
        {
          cookie,
          idempotencyKey: "private-key-value",
        },
      );

      expect(res.text).not.toContain(customerId);
      expect(res.text).not.toContain("private-key-value");
      expect(res.text).not.toMatch(/initiated_?by|idempotency|password|ledger/i);
      expect(res.headers["cache-control"]).toBe("no-store");
    });
  });
});
