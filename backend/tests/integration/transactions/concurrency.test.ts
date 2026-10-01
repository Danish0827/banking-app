import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { resetDatabase } from "../../helpers/database.js";
import {
  balanceOf,
  createCustomerWithAccount,
  expectLedgerConsistent,
  postMovement,
  recordsFor,
} from "../../helpers/money.js";

function statusCounts(statuses: number[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const status of statuses) counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}

describe("concurrent deposits and withdrawals", () => {
  let app: Express;

  beforeAll(async () => {
    await resetDatabase();
    app = createApp();
  });

  it("lets only one of two simultaneous $80 withdrawals from $100 succeed", async () => {
    const { accountId, cookie } = await createCustomerWithAccount(10_000);

    const responses = await Promise.all([
      postMovement(app, "withdrawals", accountId, { amount: 8_000 }, { cookie }),
      postMovement(app, "withdrawals", accountId, { amount: 8_000 }, { cookie }),
    ]);

    expect(responses.map((res) => res.status).sort()).toEqual([201, 422]);
    expect(responses.find((res) => res.status === 422)?.body.error.code).toBe("INSUFFICIENT_FUNDS");
    expect(await balanceOf(accountId)).toBe(2_000);

    const { transactions } = await recordsFor(accountId);
    expect(transactions.filter((t) => t.type === "withdrawal")).toHaveLength(1);
    await expectLedgerConsistent(accountId);
  });

  it("never overspends under many simultaneous withdrawals", async () => {
    const { accountId, cookie } = await createCustomerWithAccount(10_000);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        postMovement(app, "withdrawals", accountId, { amount: 1_000 }, { cookie }),
      ),
    );

    // Exactly ten $10 withdrawals fit in $100.
    expect(statusCounts(responses.map((res) => res.status))).toEqual({ 201: 10, 422: 10 });
    expect(await balanceOf(accountId)).toBe(0);
    await expectLedgerConsistent(accountId);
  });

  it("loses no updates when deposits and withdrawals interleave", async () => {
    const { accountId, cookie } = await createCustomerWithAccount(3_000);

    const responses = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        index % 2 === 0
          ? postMovement(app, "deposits", accountId, { amount: 500 }, { cookie })
          : postMovement(app, "withdrawals", accountId, { amount: 700 }, { cookie }),
      ),
    );

    const deposits = responses.filter((_, index) => index % 2 === 0);
    const withdrawals = responses.filter((_, index) => index % 2 === 1);
    expect(deposits.every((res) => res.status === 201)).toBe(true);

    const succeededWithdrawals = withdrawals.filter((res) => res.status === 201).length;
    expect(withdrawals.every((res) => [201, 422].includes(res.status))).toBe(true);
    expect(await balanceOf(accountId)).toBe(3_000 + 12 * 500 - succeededWithdrawals * 700);

    const { transactions } = await recordsFor(accountId);
    expect(transactions.filter((t) => t.type === "withdrawal")).toHaveLength(succeededWithdrawals);
    expect(transactions.filter((t) => t.type === "deposit")).toHaveLength(13); // + opening
    await expectLedgerConsistent(accountId);
  });

  it("waits for the row lock and decides on the balance committed by the lock holder", async () => {
    const { accountId, cookie } = await createCustomerWithAccount(10_000);

    // Another transaction holds the account row and changes the balance.
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE", [accountId]);

      let settled = false;
      const withdrawal = postMovement(
        app,
        "withdrawals",
        accountId,
        { amount: 5_000 },
        {
          cookie,
        },
      ).then((res) => {
        settled = true;
        return res;
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false); // still blocked on the lock

      await holder.query("UPDATE accounts SET balance = 1000 WHERE id = $1", [accountId]);
      await holder.query("COMMIT");

      // The $100 balance seen before the lock is irrelevant: only $10 is left.
      const res = await withdrawal;
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("INSUFFICIENT_FUNDS");
      expect(await balanceOf(accountId)).toBe(1_000);
    } finally {
      holder.release();
    }
  });

  it("does not block movements on other accounts", async () => {
    const first = await createCustomerWithAccount(10_000);
    const second = await createCustomerWithAccount(10_000);

    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE", [first.accountId]);

      const res = await postMovement(
        app,
        "withdrawals",
        second.accountId,
        { amount: 100 },
        {
          cookie: second.cookie,
        },
      );

      expect(res.status).toBe(201);
      await holder.query("ROLLBACK");
    } finally {
      holder.release();
    }
  });
});
