import type { Express } from "express";
import type { Response } from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { resetDatabase } from "../../helpers/database.js";
import {
  balanceOf,
  createCustomerWithAccount,
  expectLedgerConsistent,
  postTransfer,
  recordsFor,
  type TestCustomer,
} from "../../helpers/money.js";

/** Every response must be a business outcome; a deadlock or other failure would be a 500. */
function expectOnlyOutcomes(responses: Response[], allowed: number[]) {
  const unexpected = responses.filter((res) => !allowed.includes(res.status));
  expect(unexpected.map((res) => [res.status, res.body.error?.code])).toEqual([]);
}

function countStatus(responses: Response[], status: number) {
  return responses.filter((res) => res.status === status).length;
}

/** Interleaves the given request factories so they are all in flight at once. */
function inParallel(requests: (() => Promise<Response>)[]) {
  return Promise.all(requests.map((send) => send()));
}

describe("concurrent transfers", () => {
  let app: Express;

  beforeAll(async () => {
    await resetDatabase();
    app = createApp();
  });

  it("never overspends a source under many simultaneous transfers", async () => {
    const source = await createCustomerWithAccount(10_000);
    const destinations = await Promise.all(
      Array.from({ length: 4 }, () => createCustomerWithAccount(0)),
    );

    const responses = await inParallel(
      Array.from({ length: 20 }, (_, index) => () => {
        const destination = destinations[index % destinations.length] as TestCustomer;
        return postTransfer(app, source.accountId, destination.accountId, 1_000, {
          cookie: source.cookie,
        });
      }),
    );

    // Exactly ten $10 transfers fit in $100.
    expectOnlyOutcomes(responses, [201, 422]);
    expect(countStatus(responses, 201)).toBe(10);
    expect(await balanceOf(source.accountId)).toBe(0);

    const received = await Promise.all(destinations.map((d) => balanceOf(d.accountId)));
    expect(received.reduce((sum, balance) => sum + balance, 0)).toBe(10_000);

    await expectLedgerConsistent(source.accountId);
    for (const destination of destinations) {
      await expectLedgerConsistent(destination.accountId);
    }
  });

  it("credits every simultaneous transfer into the same destination", async () => {
    const destination = await createCustomerWithAccount(0);
    const sources = await Promise.all(
      Array.from({ length: 10 }, () => createCustomerWithAccount(5_000)),
    );

    const responses = await inParallel(
      sources.flatMap((source) =>
        [1, 2].map(
          () => () =>
            postTransfer(app, source.accountId, destination.accountId, 500, {
              cookie: source.cookie,
            }),
        ),
      ),
    );

    expectOnlyOutcomes(responses, [201]);
    expect(await balanceOf(destination.accountId)).toBe(20 * 500);
    for (const source of sources) {
      expect(await balanceOf(source.accountId)).toBe(4_000);
    }
    await expectLedgerConsistent(destination.accountId);
  });

  it("does not deadlock when transfers run in opposite directions (A→B and B→A)", async () => {
    const a = await createCustomerWithAccount(100_000);
    const b = await createCustomerWithAccount(100_000);

    // 30 in each direction, interleaved so both directions are always in flight.
    const responses = await inParallel(
      Array.from(
        { length: 60 },
        (_, index) => () =>
          index % 2 === 0
            ? postTransfer(app, a.accountId, b.accountId, 700, { cookie: a.cookie })
            : postTransfer(app, b.accountId, a.accountId, 700, { cookie: b.cookie }),
      ),
    );

    // Both accounts can always cover these, so every transfer must succeed.
    expectOnlyOutcomes(responses, [201]);
    expect(await balanceOf(a.accountId)).toBe(100_000);
    expect(await balanceOf(b.accountId)).toBe(100_000);

    const { transactions } = await recordsFor(a.accountId);
    expect(transactions.filter((t) => t.type === "transfer")).toHaveLength(60);
    await expectLedgerConsistent(a.accountId);
    await expectLedgerConsistent(b.accountId);
  });

  it("does not deadlock in a cycle of transfers (A→B→C→A)", async () => {
    const accounts = await Promise.all(
      Array.from({ length: 3 }, () => createCustomerWithAccount(50_000)),
    );

    const responses = await inParallel(
      Array.from({ length: 45 }, (_, index) => () => {
        const from = accounts[index % 3] as TestCustomer;
        const to = accounts[(index + 1) % 3] as TestCustomer;
        return postTransfer(app, from.accountId, to.accountId, 300, { cookie: from.cookie });
      }),
    );

    expectOnlyOutcomes(responses, [201]);
    for (const account of accounts) {
      // Each account sent and received 15 transfers of $3.
      expect(await balanceOf(account.accountId)).toBe(50_000);
      await expectLedgerConsistent(account.accountId);
    }
  });

  it("conserves money and never goes negative across many competing transfers", async () => {
    const accounts = await Promise.all(
      Array.from({ length: 4 }, () => createCustomerWithAccount(2_000)),
    );

    const responses = await inParallel(
      Array.from({ length: 48 }, (_, index) => () => {
        const from = accounts[index % 4] as TestCustomer;
        // Each account sends to each of the other three in turn.
        const to = accounts[(index + 1 + (Math.floor(index / 4) % 3)) % 4] as TestCustomer;
        return postTransfer(app, from.accountId, to.accountId, 900, { cookie: from.cookie });
      }),
    );

    expectOnlyOutcomes(responses, [201, 422]);

    const balances = await Promise.all(accounts.map((a) => balanceOf(a.accountId)));
    expect(balances.every((balance) => balance >= 0)).toBe(true);
    expect(balances.reduce((sum, balance) => sum + balance, 0)).toBe(4 * 2_000);
    const transfers = new Set<string>();
    for (const account of accounts) {
      const { transactions } = await recordsFor(account.accountId);
      for (const t of transactions) if (t.type === "transfer") transfers.add(t.id);
      await expectLedgerConsistent(account.accountId);
    }
    expect(transfers.size).toBe(countStatus(responses, 201));
  });

  it("does not block transfers between unrelated accounts", async () => {
    const a = await createCustomerWithAccount(10_000);
    const b = await createCustomerWithAccount(10_000);
    const c = await createCustomerWithAccount(10_000);
    const d = await createCustomerWithAccount(10_000);

    // Another transaction holds A's row lock.
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE", [a.accountId]);

      let involvingASettled = false;
      const involvingA = postTransfer(app, b.accountId, a.accountId, 100, {
        cookie: b.cookie,
      }).then((res) => {
        involvingASettled = true;
        return res;
      });

      // C→D shares no row with the holder and completes immediately.
      const unrelated = await postTransfer(app, c.accountId, d.accountId, 100, {
        cookie: c.cookie,
      });
      expect(unrelated.status).toBe(201);

      // B→A must wait for A's lock.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(involvingASettled).toBe(false);

      await holder.query("COMMIT");
      expect((await involvingA).status).toBe(201);
    } finally {
      holder.release();
    }
  });
});
