import type { Express } from "express";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { resetDatabase } from "../../helpers/database.js";
import { activity, getHistory } from "../../helpers/history.js";
import { createCustomerWithAccount, type TestCustomer } from "../../helpers/money.js";

const DEPOSITS = 45;

interface Item {
  transactionId: string;
  amount: number;
  balanceAfter: number;
}

describe("transaction history pagination", () => {
  let app: Express;
  let customer: TestCustomer;
  /** Transaction ids in the order they were made (oldest first). */
  const created: string[] = [];

  beforeAll(async () => {
    await resetDatabase();
    app = createApp();
    customer = await createCustomerWithAccount(0);

    // Deposits of 1, 2, 3 ... cents: each line has a distinct amount, and
    // newest-first order means strictly decreasing balances.
    for (let amount = 1; amount <= DEPOSITS; amount += 1) {
      created.push(await activity.deposit(customer.customerId, customer.accountId, amount));
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Follows nextCursor until the last page; returns every page. */
  async function allPages(query: Record<string, string>): Promise<Item[][]> {
    const pages: Item[][] = [];
    let cursor: string | null = null;
    do {
      const res = await getHistory(app, customer.cookie, cursor ? { ...query, cursor } : query);
      expect(res.status).toBe(200);
      pages.push(res.body.data.transactions);
      cursor = res.body.data.nextCursor;
    } while (cursor !== null && pages.length < 100);
    return pages;
  }

  it("returns 20 items and a cursor by default", async () => {
    const res = await getHistory(app, customer.cookie);

    expect(res.body.data.transactions).toHaveLength(20);
    expect(res.body.data.nextCursor).toEqual(expect.any(String));
    expect(res.body.data.transactions[0].amount).toBe(DEPOSITS);
  });

  it("honours a custom page size", async () => {
    const res = await getHistory(app, customer.cookie, { limit: "7" });

    expect(res.body.data.transactions.map((item: Item) => item.amount)).toEqual([
      45, 44, 43, 42, 41, 40, 39,
    ]);
  });

  it("returns everything on one page when the maximum page size covers it", async () => {
    const res = await getHistory(app, customer.cookie, { limit: "100" });

    expect(res.body.data.transactions).toHaveLength(DEPOSITS);
    expect(res.body.data.nextCursor).toBeNull();
  });

  it("walks every page without duplicates or gaps", async () => {
    const pages = await allPages({ limit: "7" });

    expect(pages.map((page) => page.length)).toEqual([7, 7, 7, 7, 7, 7, 3]);
    const items = pages.flat();
    expect(items.map((item) => item.transactionId)).toEqual([...created].reverse());

    // Strictly newest first across page boundaries.
    for (let index = 1; index < items.length; index += 1) {
      expect(items[index]!.balanceAfter).toBeLessThan(items[index - 1]!.balanceAfter);
    }
  });

  it("returns no cursor when the last page is exactly full", async () => {
    const pages = await allPages({ limit: "15" });

    expect(pages.map((page) => page.length)).toEqual([15, 15, 15]);
  });

  it("keeps later pages stable when new transactions arrive meanwhile", async () => {
    const other = await createCustomerWithAccount(0);
    for (let amount = 1; amount <= 10; amount += 1) {
      await activity.deposit(other.customerId, other.accountId, amount);
    }

    const first = await getHistory(app, other.cookie, { limit: "4" });
    const newest = await activity.deposit(other.customerId, other.accountId, 999);
    const second = await getHistory(app, other.cookie, {
      limit: "4",
      cursor: first.body.data.nextCursor,
    });

    expect(first.body.data.transactions.map((item: Item) => item.amount)).toEqual([10, 9, 8, 7]);
    expect(second.body.data.transactions.map((item: Item) => item.amount)).toEqual([6, 5, 4, 3]);
    expect(JSON.stringify(second.body)).not.toContain(newest);
  });

  it("paginates within a filter", async () => {
    const pages = await allPages({ limit: "10", type: "deposit", accountId: customer.accountId });

    expect(pages.flat()).toHaveLength(DEPOSITS);
  });

  it.each([
    ["0", "limit"],
    ["101", "limit"],
    ["-1", "limit"],
    ["1.5", "limit"],
    ["ten", "limit"],
    ["", "limit"],
  ])("rejects limit=%j", async (limit, path) => {
    const res = await getHistory(app, customer.cookie, { limit });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it.each(["abc", "0", "-5", "1.5", "9999999999999999"])("rejects cursor=%j", async (cursor) => {
    const res = await getHistory(app, customer.cookie, { cursor });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain("cursor");
  });

  it("applies the page size in the database query, never reading the whole history", async () => {
    const query = vi.spyOn(pool, "query");

    await getHistory(app, customer.cookie, { limit: "5" });

    const historyCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM ledger_entries e"),
    );
    expect(historyCalls).toHaveLength(1);

    const [sql, params] = historyCalls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/ORDER BY e\.id DESC\s+LIMIT \$\d+\s*$/);
    // One row more than the page, to detect whether another page exists.
    expect(params.at(-1)).toBe(6);

    const result = (await query.mock.results.find(
      (_, index) => query.mock.calls[index] === historyCalls[0],
    )?.value) as { rows: unknown[] };
    expect(result.rows).toHaveLength(6);
  });
});
