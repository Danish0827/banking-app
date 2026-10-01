import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { seedDatabase } from "../../../src/db/seed/seed.js";
import { createSessionToken } from "../../../src/modules/auth/session.js";
import { ALICE, BOB, cookieHeader } from "../../helpers/auth.js";
import { resetDatabase } from "../../helpers/database.js";
import {
  addAccount,
  balanceOf,
  countRows,
  createCustomerWithAccount,
  expectLedgerConsistent,
  postMovement,
  postTransfer,
  recordsFor,
} from "../../helpers/money.js";

const ALICE_CHECKING = ALICE.accounts[0]?.id as string;
const ALICE_SAVINGS = ALICE.accounts[1]?.id as string;
const BOB_CHECKING = BOB.accounts[0]?.id as string;
const UNKNOWN_ACCOUNT = "00000000-0000-4000-8000-00000000dead";

describe("transfers", () => {
  let app: Express;
  let aliceCookie: string;

  beforeAll(async () => {
    await resetDatabase();
    await seedDatabase({ bcryptRounds: 4 });
    app = createApp();
    aliceCookie = cookieHeader(await createSessionToken(ALICE.id));
  });

  /** Balances of the given accounts, and the row counts of both ledger tables. */
  async function snapshot(...accountIds: string[]) {
    return {
      balances: await Promise.all(accountIds.map(balanceOf)),
      transactions: await countRows("transactions"),
      entries: await countRows("ledger_entries"),
    };
  }

  describe("authentication", () => {
    it("rejects a transfer without a session and moves no money", async () => {
      const before = await snapshot(ALICE_CHECKING, BOB_CHECKING);

      const res = await postTransfer(app, ALICE_CHECKING, BOB_CHECKING, 100);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
      expect(await snapshot(ALICE_CHECKING, BOB_CHECKING)).toEqual(before);
    });

    it("rejects an invalid session", async () => {
      const res = await postTransfer(app, ALICE_CHECKING, BOB_CHECKING, 100, {
        cookie: cookieHeader("not-a-valid-token"),
      });

      expect(res.status).toBe(401);
    });

    it("authenticates before validating anything else", async () => {
      const res = await postMovement(
        app,
        "transfers",
        "not-a-uuid",
        { amount: -1 },
        {
          idempotencyKey: null,
        },
      );

      expect(res.status).toBe(401);
    });

    it("lets an authenticated customer transfer", async () => {
      const sender = await createCustomerWithAccount(10_000);
      const recipient = await createCustomerWithAccount(0);

      const res = await postTransfer(app, sender.accountId, recipient.accountId, 2_500, {
        cookie: sender.cookie,
      });

      expect(res.status).toBe(201);
    });
  });

  describe("ownership", () => {
    it("does not let Alice transfer out of Bob's account", async () => {
      const before = await snapshot(BOB_CHECKING, ALICE_CHECKING);

      const res = await postTransfer(app, BOB_CHECKING, ALICE_CHECKING, 100, {
        cookie: aliceCookie,
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toEqual({
        code: "ACCOUNT_NOT_FOUND",
        message: "Account not found",
        requestId: expect.any(String),
      });
      expect(await snapshot(BOB_CHECKING, ALICE_CHECKING)).toEqual(before);
    });

    it("answers identically for someone else's source account and a non-existent one", async () => {
      const someoneElses = await postTransfer(app, BOB_CHECKING, ALICE_CHECKING, 100, {
        cookie: aliceCookie,
      });
      const nonExistent = await postTransfer(app, UNKNOWN_ACCOUNT, ALICE_CHECKING, 100, {
        cookie: aliceCookie,
      });

      expect(someoneElses.status).toBe(nonExistent.status);
      expect({ ...someoneElses.body.error, requestId: null }).toEqual({
        ...nonExistent.body.error,
        requestId: null,
      });
    });

    it("rejects a customer id in the body instead of trusting it", async () => {
      const before = await snapshot(BOB_CHECKING);

      const res = await postMovement(
        app,
        "transfers",
        BOB_CHECKING,
        { destinationAccountId: ALICE_CHECKING, amount: 100, customerId: BOB.id },
        { cookie: aliceCookie },
      );

      expect(res.status).toBe(400);
      expect(await snapshot(BOB_CHECKING)).toEqual(before);
    });

    it("ignores a customer id in the query string", async () => {
      const res = await postMovement(
        app,
        `transfers?customerId=${BOB.id}` as "transfers",
        BOB_CHECKING,
        { destinationAccountId: ALICE_CHECKING, amount: 100 },
        { cookie: aliceCookie },
      );

      expect(res.status).toBe(404);
    });

    it("allows a destination owned by another customer", async () => {
      const aliceBefore = await balanceOf(ALICE_CHECKING);
      const bobBefore = await balanceOf(BOB_CHECKING);

      const res = await postTransfer(app, ALICE_CHECKING, BOB_CHECKING, 1_234, {
        cookie: aliceCookie,
      });

      expect(res.status).toBe(201);
      expect(await balanceOf(ALICE_CHECKING)).toBe(aliceBefore - 1_234);
      expect(await balanceOf(BOB_CHECKING)).toBe(bobBefore + 1_234);
    });

    it("never reveals another customer's balance, account number or identity", async () => {
      const res = await postTransfer(app, ALICE_CHECKING, BOB_CHECKING, 100, {
        cookie: aliceCookie,
      });

      expect(res.body.data.destinationAccount).toBeNull();
      expect(res.text).not.toContain(BOB.id);
      expect(res.text).not.toContain(BOB.accounts[0]?.accountNumber as string);
      expect(res.text).not.toContain(String(await balanceOf(BOB_CHECKING)));
      expect(res.text).not.toMatch(/customer_?id|initiated_?by|idempotency|password/i);
    });

    it("returns the destination account when the sender owns it", async () => {
      const res = await postTransfer(app, ALICE_CHECKING, ALICE_SAVINGS, 100, {
        cookie: aliceCookie,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.destinationAccount).toMatchObject({
        id: ALICE_SAVINGS,
        balance: await balanceOf(ALICE_SAVINGS),
      });
    });
  });

  describe("validation", () => {
    const expectRejected = async (body: unknown, path: string) => {
      const before = await snapshot(ALICE_CHECKING, BOB_CHECKING);

      const res = await postMovement(app, "transfers", ALICE_CHECKING, body, {
        cookie: aliceCookie,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
      expect(await snapshot(ALICE_CHECKING, BOB_CHECKING)).toEqual(before);
    };

    it("rejects a missing destination", async () => {
      await expectRejected({ amount: 100 }, "destinationAccountId");
    });

    it.each([
      ["a non-UUID string", "not-a-uuid"],
      ["an account number", "1000000003"],
      ["a number", 1_000_000_003],
      ["null", null],
      ["an empty string", ""],
    ])("rejects %s as the destination", async (_label, destinationAccountId) => {
      await expectRejected({ destinationAccountId, amount: 100 }, "destinationAccountId");
    });

    it.each([
      ["zero", 0],
      ["a negative amount", -100],
      ["a decimal amount", 10.5],
      ["a numeric string", "1000"],
      ["null", null],
      ["an unsafe integer", Number.MAX_SAFE_INTEGER + 2],
      ["one cent over the maximum", 100_000_001],
    ])("rejects %s as the amount", async (_label, amount) => {
      await expectRejected({ destinationAccountId: BOB_CHECKING, amount }, "amount");
    });

    it("rejects a missing amount", async () => {
      await expectRejected({ destinationAccountId: BOB_CHECKING }, "amount");
    });

    it("rejects unknown fields", async () => {
      await expectRejected({ destinationAccountId: BOB_CHECKING, amount: 100, memo: "x" }, "");
    });

    it("rejects a malformed source account id", async () => {
      const res = await postTransfer(app, "not-a-uuid", BOB_CHECKING, 100, {
        cookie: aliceCookie,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { path: "accountId", message: "Invalid account id" },
      ]);
    });

    it("requires an Idempotency-Key", async () => {
      const res = await postTransfer(app, ALICE_CHECKING, BOB_CHECKING, 100, {
        cookie: aliceCookie,
        idempotencyKey: null,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { path: "Idempotency-Key", message: "Idempotency-Key header is required" },
      ]);
    });

    it.each([
      ["the same id", ALICE_CHECKING],
      ["the same id in upper case", ALICE_CHECKING.toUpperCase()],
    ])("rejects a transfer to the source account itself (%s)", async (_label, destination) => {
      const before = await snapshot(ALICE_CHECKING);

      const res = await postTransfer(app, ALICE_CHECKING, destination, 100, {
        cookie: aliceCookie,
      });

      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({
        code: "SAME_ACCOUNT_TRANSFER",
        message: "Source and destination accounts must be different",
        requestId: expect.any(String),
      });
      expect(await snapshot(ALICE_CHECKING)).toEqual(before);
    });

    it("rejects a destination that does not exist and changes nothing", async () => {
      const before = await snapshot(ALICE_CHECKING);

      const res = await postTransfer(app, ALICE_CHECKING, UNKNOWN_ACCOUNT, 100, {
        cookie: aliceCookie,
      });

      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({
        code: "DESTINATION_ACCOUNT_NOT_FOUND",
        message: "Destination account not found",
        requestId: expect.any(String),
      });
      expect(await snapshot(ALICE_CHECKING)).toEqual(before);
    });

    it("accepts account ids in upper case", async () => {
      const sender = await createCustomerWithAccount(1_000);
      const recipient = await createCustomerWithAccount(0);

      const res = await postTransfer(
        app,
        sender.accountId.toUpperCase(),
        recipient.accountId.toUpperCase(),
        100,
        { cookie: sender.cookie },
      );

      expect(res.status).toBe(201);
      expect(res.body.data.transaction.sourceAccountId).toBe(sender.accountId);
      expect(res.body.data.transaction.destinationAccountId).toBe(recipient.accountId);
    });
  });

  describe("successful transfer", () => {
    it("moves the amount from source to destination and returns the result", async () => {
      const sender = await createCustomerWithAccount(10_000);
      const recipient = await createCustomerWithAccount(500);

      const res = await postTransfer(app, sender.accountId, recipient.accountId, 2_550, {
        cookie: sender.cookie,
      });

      expect(res.status).toBe(201);
      expect(res.headers["idempotent-replayed"]).toBeUndefined();
      expect(res.body).toEqual({
        data: {
          transaction: {
            id: expect.any(String),
            type: "transfer",
            sourceAccountId: sender.accountId,
            destinationAccountId: recipient.accountId,
            amount: 2_550,
            currency: "USD",
            balanceAfter: 7_450,
            createdAt: expect.any(String),
          },
          account: {
            id: sender.accountId,
            accountNumber: expect.any(String),
            type: "checking",
            currency: "USD",
            balance: 7_450,
            createdAt: expect.any(String),
          },
          destinationAccount: null,
        },
      });
      expect(await balanceOf(sender.accountId)).toBe(7_450);
      expect(await balanceOf(recipient.accountId)).toBe(3_050);
    });

    it("records one transfer transaction with exactly one debit and one credit", async () => {
      const sender = await createCustomerWithAccount(10_000);
      const recipient = await createCustomerWithAccount(500);
      const entriesBefore = await countRows("ledger_entries");

      const res = await postTransfer(app, sender.accountId, recipient.accountId, 2_550, {
        cookie: sender.cookie,
        idempotencyKey: "transfer-record-check",
      });
      const transactionId = res.body.data.transaction.id;

      const { rows } = await pool.query(
        `SELECT type, amount, currency, source_account_id, destination_account_id,
                initiated_by, idempotency_key
         FROM transactions WHERE id = $1`,
        [transactionId],
      );
      expect(rows).toEqual([
        {
          type: "transfer",
          amount: 2_550,
          currency: "USD",
          source_account_id: sender.accountId,
          destination_account_id: recipient.accountId,
          initiated_by: sender.customerId,
          idempotency_key: "transfer-record-check",
        },
      ]);

      const entries = await pool.query(
        `SELECT account_id, direction, amount, balance_after
         FROM ledger_entries WHERE transaction_id = $1 ORDER BY id`,
        [transactionId],
      );
      expect(entries.rows).toEqual([
        { account_id: sender.accountId, direction: "debit", amount: 2_550, balance_after: 7_450 },
        {
          account_id: recipient.accountId,
          direction: "credit",
          amount: 2_550,
          balance_after: 3_050,
        },
      ]);
      expect(await countRows("ledger_entries")).toBe(entriesBefore + 2);

      await expectLedgerConsistent(sender.accountId);
      await expectLedgerConsistent(recipient.accountId);
    });

    it("allows transferring the entire balance", async () => {
      const sender = await createCustomerWithAccount(10_000);
      const recipient = await createCustomerWithAccount(0);

      const res = await postTransfer(app, sender.accountId, recipient.accountId, 10_000, {
        cookie: sender.cookie,
      });

      expect(res.status).toBe(201);
      expect(await balanceOf(sender.accountId)).toBe(0);
      expect(await balanceOf(recipient.accountId)).toBe(10_000);
    });

    it("transfers between two accounts of the same customer", async () => {
      const customer = await createCustomerWithAccount(10_000);
      const savings = await addAccount(customer.customerId);

      const res = await postTransfer(app, customer.accountId, savings, 4_000, {
        cookie: customer.cookie,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.account.balance).toBe(6_000);
      expect(res.body.data.destinationAccount.balance).toBe(4_000);
      await expectLedgerConsistent(customer.accountId);
      await expectLedgerConsistent(savings);
    });
  });

  describe("insufficient funds", () => {
    it.each([
      ["one cent more than the balance", 10_000, 10_001],
      ["from an empty account", 0, 1],
    ])("rejects a transfer of %s and changes nothing", async (_label, opening, amount) => {
      const sender = await createCustomerWithAccount(opening);
      const recipient = await createCustomerWithAccount(700);
      const before = await snapshot(sender.accountId, recipient.accountId);
      const recordsBefore = await recordsFor(recipient.accountId);

      const res = await postTransfer(app, sender.accountId, recipient.accountId, amount, {
        cookie: sender.cookie,
      });

      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({
        code: "INSUFFICIENT_FUNDS",
        message: "Insufficient funds for this transfer",
        requestId: expect.any(String),
      });
      expect(await snapshot(sender.accountId, recipient.accountId)).toEqual(before);
      expect(await recordsFor(recipient.accountId)).toEqual(recordsBefore);
    });

    it("leaves the idempotency key reusable", async () => {
      const sender = await createCustomerWithAccount(1_000);
      const recipient = await createCustomerWithAccount(0);
      const options = { cookie: sender.cookie, idempotencyKey: "insufficient-then-retry" };

      const refused = await postTransfer(
        app,
        sender.accountId,
        recipient.accountId,
        5_000,
        options,
      );
      expect(refused.status).toBe(422);

      await postMovement(
        app,
        "deposits",
        sender.accountId,
        { amount: 9_000 },
        {
          cookie: sender.cookie,
        },
      );
      const retried = await postTransfer(
        app,
        sender.accountId,
        recipient.accountId,
        5_000,
        options,
      );

      expect(retried.status).toBe(201);
      expect(retried.headers["idempotent-replayed"]).toBeUndefined();
      expect(await balanceOf(sender.accountId)).toBe(5_000);
      expect(await balanceOf(recipient.accountId)).toBe(5_000);
    });
  });
});
