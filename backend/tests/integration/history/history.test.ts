import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { cookieHeader } from "../../helpers/auth.js";
import { resetDatabase } from "../../helpers/database.js";
import { activity, getHistory, timeMarker } from "../../helpers/history.js";
import {
  addAccount,
  countRows,
  createCustomerWithAccount,
  expectLedgerConsistent,
  type TestCustomer,
} from "../../helpers/money.js";

/**
 * Scenario, in order (amounts in cents):
 *
 *   1. Alice deposits 10000 into checking            A1 = 10000
 *   2. Alice withdraws 2500 from checking            A1 =  7500
 *   3. Alice transfers 1000 checking -> Bob          A1 =  6500  B1 = 1000
 *      -- marker --
 *   4. Bob deposits 5000                             B1 =  6000
 *   5. Bob transfers 700 -> Alice's savings          B1 =  5300  A2 = 700
 *   6. Alice transfers 300 checking -> her savings   A1 =  6200  A2 = 1000
 *   7. Carol deposits 9999, sends 111 to Bob         C1 =  9888  B1 = 5411
 */
describe("transaction history", () => {
  let app: Express;
  let alice: TestCustomer;
  let aliceSavings: string;
  let bob: TestCustomer;
  let carol: TestCustomer;
  const tx: Record<string, string> = {};
  let beforeStart: string;
  let afterStep3: string;

  beforeAll(async () => {
    await resetDatabase();
    app = createApp();

    alice = await createCustomerWithAccount(0);
    aliceSavings = await addAccount(alice.customerId);
    bob = await createCustomerWithAccount(0);
    carol = await createCustomerWithAccount(0);

    beforeStart = await timeMarker();
    tx.deposit = await activity.deposit(alice.customerId, alice.accountId, 10_000);
    tx.withdrawal = await activity.withdraw(alice.customerId, alice.accountId, 2_500);
    tx.sentToBob = await activity.transfer(alice.customerId, alice.accountId, bob.accountId, 1_000);
    afterStep3 = await timeMarker();
    tx.bobDeposit = await activity.deposit(bob.customerId, bob.accountId, 5_000);
    tx.receivedFromBob = await activity.transfer(bob.customerId, bob.accountId, aliceSavings, 700);
    tx.ownTransfer = await activity.transfer(alice.customerId, alice.accountId, aliceSavings, 300);
    tx.carolDeposit = await activity.deposit(carol.customerId, carol.accountId, 9_999);
    tx.carolToBob = await activity.transfer(carol.customerId, carol.accountId, bob.accountId, 111);
  });

  /** Alice's full history as the API should return it, newest first. */
  const aliceHistory = () => [
    {
      transactionId: tx.ownTransfer,
      type: "transfer",
      direction: "credit",
      amount: 300,
      currency: "USD",
      accountId: aliceSavings,
      balanceAfter: 1_000,
      counterparty: { accountId: alice.accountId, ownedByYou: true },
      createdAt: expect.any(String),
    },
    {
      transactionId: tx.ownTransfer,
      type: "transfer",
      direction: "debit",
      amount: 300,
      currency: "USD",
      accountId: alice.accountId,
      balanceAfter: 6_200,
      counterparty: { accountId: aliceSavings, ownedByYou: true },
      createdAt: expect.any(String),
    },
    {
      transactionId: tx.receivedFromBob,
      type: "transfer",
      direction: "credit",
      amount: 700,
      currency: "USD",
      accountId: aliceSavings,
      balanceAfter: 700,
      counterparty: { accountId: null, ownedByYou: false },
      createdAt: expect.any(String),
    },
    {
      transactionId: tx.sentToBob,
      type: "transfer",
      direction: "debit",
      amount: 1_000,
      currency: "USD",
      accountId: alice.accountId,
      balanceAfter: 6_500,
      counterparty: { accountId: bob.accountId, ownedByYou: false },
      createdAt: expect.any(String),
    },
    {
      transactionId: tx.withdrawal,
      type: "withdrawal",
      direction: "debit",
      amount: 2_500,
      currency: "USD",
      accountId: alice.accountId,
      balanceAfter: 7_500,
      counterparty: null,
      createdAt: expect.any(String),
    },
    {
      transactionId: tx.deposit,
      type: "deposit",
      direction: "credit",
      amount: 10_000,
      currency: "USD",
      accountId: alice.accountId,
      balanceAfter: 10_000,
      counterparty: null,
      createdAt: expect.any(String),
    },
  ];

  const ids = (res: { body: { data: { transactions: { transactionId: string }[] } } }) =>
    res.body.data.transactions.map((item) => item.transactionId);

  describe("authentication", () => {
    it("rejects a request without a session", async () => {
      const res = await getHistory(app);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects an invalid session", async () => {
      const res = await getHistory(app, cookieHeader("not-a-valid-token"));

      expect(res.status).toBe(401);
    });

    it("returns the authenticated customer's history", async () => {
      const res = await getHistory(app, alice.cookie);

      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
    });
  });

  describe("content", () => {
    it("returns exactly the customer's entries, newest first, with every field", async () => {
      const res = await getHistory(app, alice.cookie);

      expect(res.body).toEqual({ data: { transactions: aliceHistory(), nextCursor: null } });
    });

    it("includes deposits, withdrawals, and transfers both sent and received", async () => {
      const res = await getHistory(app, alice.cookie);
      const items = res.body.data.transactions as { type: string; direction: string }[];

      expect(items.map((item) => `${item.type}:${item.direction}`).sort()).toEqual([
        "deposit:credit",
        "transfer:credit",
        "transfer:credit",
        "transfer:debit",
        "transfer:debit",
        "withdrawal:debit",
      ]);
    });

    it("reports each transaction's own timestamp", async () => {
      const res = await getHistory(app, alice.cookie);

      const { rows } = await pool.query<{ id: string; created_at: Date }>(
        "SELECT id, created_at FROM transactions WHERE id = ANY($1)",
        [Object.values(tx)],
      );
      const createdAt = new Map(rows.map((row) => [row.id, row.created_at.toISOString()]));
      for (const item of res.body.data.transactions as {
        transactionId: string;
        createdAt: string;
      }[]) {
        expect(item.createdAt).toBe(createdAt.get(item.transactionId));
      }
    });

    it("returns amounts and balances as integer cents", async () => {
      const res = await getHistory(app, alice.cookie);

      for (const item of res.body.data.transactions as {
        amount: unknown;
        balanceAfter: unknown;
      }[]) {
        expect(Number.isInteger(item.amount)).toBe(true);
        expect(Number.isInteger(item.balanceAfter)).toBe(true);
      }
    });

    it("returns an empty history for a customer with no activity", async () => {
      const quiet = await createCustomerWithAccount(0);

      const res = await getHistory(app, quiet.cookie);

      expect(res.body).toEqual({ data: { transactions: [], nextCursor: null } });
    });

    it("is read-only: listing changes no balance, transaction or ledger entry", async () => {
      const before = { tx: await countRows("transactions"), le: await countRows("ledger_entries") };

      await getHistory(app, alice.cookie);
      await getHistory(app, bob.cookie);

      expect({
        tx: await countRows("transactions"),
        le: await countRows("ledger_entries"),
      }).toEqual(before);
      for (const accountId of [alice.accountId, aliceSavings, bob.accountId, carol.accountId]) {
        await expectLedgerConsistent(accountId);
      }
    });
  });

  describe("ownership", () => {
    it("only ever returns lines for accounts the customer owns", async () => {
      for (const [customer, owned] of [
        [alice, [alice.accountId, aliceSavings]],
        [bob, [bob.accountId]],
        [carol, [carol.accountId]],
      ] as const) {
        const res = await getHistory(app, customer.cookie);
        for (const item of res.body.data.transactions as { accountId: string }[]) {
          expect(owned).toContain(item.accountId);
        }
      }
    });

    it("hides other customers' unrelated transactions", async () => {
      const res = await getHistory(app, alice.cookie);

      expect(ids(res)).not.toContain(tx.bobDeposit);
      expect(ids(res)).not.toContain(tx.carolDeposit);
      expect(ids(res)).not.toContain(tx.carolToBob);
    });

    it("shows a transfer to both sides, each seeing only their own side", async () => {
      const aliceRes = await getHistory(app, alice.cookie);
      const bobRes = await getHistory(app, bob.cookie);

      const aliceLine = aliceRes.body.data.transactions.find(
        (item: { transactionId: string }) => item.transactionId === tx.sentToBob,
      );
      const bobLine = bobRes.body.data.transactions.find(
        (item: { transactionId: string }) => item.transactionId === tx.sentToBob,
      );

      expect(aliceLine).toMatchObject({ direction: "debit", accountId: alice.accountId });
      expect(bobLine).toMatchObject({
        direction: "credit",
        accountId: bob.accountId,
        balanceAfter: 1_000,
      });
    });

    it("returns nothing when filtering by another customer's account", async () => {
      for (const accountId of [bob.accountId, carol.accountId]) {
        const res = await getHistory(app, alice.cookie, { accountId });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ transactions: [], nextCursor: null });
      }
    });

    it.each(["customerId", "customer_id", "transactionId", "ownerId"])(
      "rejects a %s query parameter instead of trusting it",
      async (name) => {
        const res = await getHistory(app, alice.cookie, { [name]: bob.customerId });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        expect(JSON.stringify(res.body)).not.toContain(tx.bobDeposit);
      },
    );
  });

  describe("transfer privacy", () => {
    it("shows the sender the destination they chose, but nothing else about it", async () => {
      const res = await getHistory(app, alice.cookie, { type: "transfer" });
      const sent = res.body.data.transactions.find(
        (item: { transactionId: string }) => item.transactionId === tx.sentToBob,
      );

      expect(sent.counterparty).toEqual({ accountId: bob.accountId, ownedByYou: false });
      expect(Object.keys(sent).sort()).toEqual([
        "accountId",
        "amount",
        "balanceAfter",
        "counterparty",
        "createdAt",
        "currency",
        "direction",
        "transactionId",
        "type",
      ]);
    });

    it("does not reveal which account money was received from", async () => {
      const res = await getHistory(app, alice.cookie);
      const received = res.body.data.transactions.find(
        (item: { transactionId: string }) => item.transactionId === tx.receivedFromBob,
      );

      expect(received.counterparty).toEqual({ accountId: null, ownedByYou: false });
      // Bob's account id appears only on the transfer Alice sent to it.
      const mentions = JSON.stringify(res.body).split(bob.accountId).length - 1;
      expect(mentions).toBe(1);
    });

    it("never returns the other customer's identity, balance or account number", async () => {
      const { rows } = await pool.query<{ account_number: string }>(
        "SELECT account_number FROM accounts WHERE id = $1",
        [bob.accountId],
      );
      const aliceRes = await getHistory(app, alice.cookie);
      const bobRes = await getHistory(app, bob.cookie);

      expect(aliceRes.text).not.toContain(bob.customerId);
      expect(aliceRes.text).not.toContain(rows[0]?.account_number as string);
      expect(aliceRes.text).not.toMatch(/customer_?id|initiated_?by|idempotency|password/i);

      // Bob sees Alice's savings (he chose it), never her checking, and no balance of hers.
      expect(bobRes.text).not.toContain(alice.customerId);
      expect(bobRes.text).not.toContain(alice.accountId);
      for (const item of bobRes.body.data.transactions as { accountId: string }[]) {
        expect(item.accountId).toBe(bob.accountId);
      }
    });

    it("shows a transfer between the customer's own accounts as sent and received", async () => {
      const res = await getHistory(app, alice.cookie);
      const lines = res.body.data.transactions.filter(
        (item: { transactionId: string }) => item.transactionId === tx.ownTransfer,
      );

      expect(lines).toHaveLength(2);
      expect(lines.map((line: { direction: string }) => line.direction).sort()).toEqual([
        "credit",
        "debit",
      ]);
      for (const line of lines) {
        expect(line.counterparty.ownedByYou).toBe(true);
      }
    });
  });

  describe("filters", () => {
    it.each([
      ["deposit", ["deposit"]],
      ["withdrawal", ["withdrawal"]],
      ["transfer", ["ownTransfer", "ownTransfer", "receivedFromBob", "sentToBob"]],
    ])("filters by type=%s", async (type, expected) => {
      const res = await getHistory(app, alice.cookie, { type });

      expect(ids(res)).toEqual(expected.map((name) => tx[name]));
    });

    it("filters by account", async () => {
      const savings = await getHistory(app, alice.cookie, { accountId: aliceSavings });
      const checking = await getHistory(app, alice.cookie, { accountId: alice.accountId });

      expect(ids(savings)).toEqual([tx.ownTransfer, tx.receivedFromBob]);
      expect(ids(checking)).toEqual([tx.ownTransfer, tx.sentToBob, tx.withdrawal, tx.deposit]);
    });

    it("accepts the account id in upper case", async () => {
      const res = await getHistory(app, alice.cookie, { accountId: aliceSavings.toUpperCase() });

      expect(ids(res)).toEqual([tx.ownTransfer, tx.receivedFromBob]);
    });

    it("filters by date range: from is inclusive, to is exclusive", async () => {
      const early = await getHistory(app, alice.cookie, { from: beforeStart, to: afterStep3 });
      const late = await getHistory(app, alice.cookie, { from: afterStep3 });

      expect(ids(early)).toEqual([tx.sentToBob, tx.withdrawal, tx.deposit]);
      expect(ids(late)).toEqual([tx.ownTransfer, tx.ownTransfer, tx.receivedFromBob]);
    });

    it("accepts plain dates", async () => {
      const all = await getHistory(app, alice.cookie, { from: "2000-01-01" });
      const none = await getHistory(app, alice.cookie, { to: "2000-01-01" });

      expect(all.body.data.transactions).toHaveLength(6);
      expect(none.body.data.transactions).toEqual([]);
    });

    it("combines filters", async () => {
      const res = await getHistory(app, alice.cookie, {
        accountId: alice.accountId,
        type: "transfer",
        from: beforeStart,
        to: afterStep3,
      });

      expect(ids(res)).toEqual([tx.sentToBob]);
    });

    it.each([
      [{ type: "refund" }, "type"],
      [{ type: "DEPOSIT" }, "type"],
      [{ accountId: "not-a-uuid" }, "accountId"],
      [{ accountId: "1000000001" }, "accountId"],
      [{ from: "yesterday" }, "from"],
      [{ from: "2026-13-01" }, "from"],
      [{ to: "2026-10-01T25:00:00Z" }, "to"],
      [{ from: "2026-10-02", to: "2026-10-01" }, "to"],
      [{ from: "2026-10-01", to: "2026-10-01" }, "to"],
      [{ sort: "amount" }, ""],
      [{ orderBy: "created_at; DROP TABLE accounts" }, ""],
    ])("rejects %j", async (query, path) => {
      const res = await getHistory(app, alice.cookie, query);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
    });

    it("rejects a filter given more than once", async () => {
      const res = await getHistory(app, alice.cookie).query("type=deposit&type=withdrawal");

      expect(res.status).toBe(400);
    });
  });
});
