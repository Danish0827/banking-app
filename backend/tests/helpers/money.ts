import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { expect } from "vitest";
import { pool } from "../../src/db/pool.js";
import { createSessionToken } from "../../src/modules/auth/session.js";
import { deposit } from "../../src/modules/transactions/transaction.service.js";
import { cookieHeader } from "./auth.js";
import { createAccount, createCustomer } from "./fixtures.js";

export type Operation = "deposits" | "withdrawals";

interface MovementOptions {
  cookie?: string;
  /** Pass `null` to omit the header. Defaults to a fresh random key. */
  idempotencyKey?: string | null;
}

/** POST /accounts/:accountId/{deposits|withdrawals} with a JSON body. */
export function postMovement(
  app: Express,
  operation: Operation,
  accountId: string,
  body: unknown,
  { cookie, idempotencyKey = randomUUID() }: MovementOptions = {},
) {
  const req = request(app).post(`/api/v1/accounts/${accountId}/${operation}`);
  if (cookie) req.set("Cookie", cookie);
  if (idempotencyKey !== null) req.set("Idempotency-Key", idempotencyKey);
  return req.send(body as object);
}

export interface TestCustomer {
  customerId: string;
  accountId: string;
  cookie: string;
}

/**
 * A new customer with one account. A non-zero opening balance is paid in
 * through the real deposit path, so the ledger matches the balance.
 */
export async function createCustomerWithAccount(openingBalance = 0): Promise<TestCustomer> {
  const customerId = await createCustomer();
  const accountId = await createAccount(customerId);
  if (openingBalance > 0) {
    await deposit(
      { customerId },
      { accountId, amount: openingBalance, idempotencyKey: `opening-${randomUUID()}` },
    );
  }
  return { customerId, accountId, cookie: cookieHeader(await createSessionToken(customerId)) };
}

export async function balanceOf(accountId: string): Promise<number> {
  const { rows } = await pool.query<{ balance: number }>(
    "SELECT balance FROM accounts WHERE id = $1",
    [accountId],
  );
  return rows[0]?.balance as number;
}

/** Transactions and ledger entries recorded for an account, oldest first. */
export async function recordsFor(accountId: string) {
  const transactions = await pool.query<{
    id: string;
    type: string;
    amount: number;
    source_account_id: string | null;
    destination_account_id: string | null;
  }>(
    `SELECT id, type, amount, source_account_id, destination_account_id
     FROM transactions
     WHERE source_account_id = $1 OR destination_account_id = $1
     ORDER BY created_at, id`,
    [accountId],
  );
  const entries = await pool.query<{
    transaction_id: string;
    direction: string;
    amount: number;
    balance_after: number;
  }>(
    `SELECT transaction_id, direction, amount, balance_after
     FROM ledger_entries
     WHERE account_id = $1
     ORDER BY id`,
    [accountId],
  );
  return { transactions: transactions.rows, entries: entries.rows };
}

/**
 * Asserts the ledger invariants for an account: the balance equals credits
 * minus debits, the latest entry's balance_after equals the balance, every
 * transaction has exactly one entry for this account, and the running
 * balance_after values are consistent entry by entry.
 */
export async function expectLedgerConsistent(accountId: string): Promise<void> {
  const balance = await balanceOf(accountId);
  const { transactions, entries } = await recordsFor(accountId);

  expect(balance).toBeGreaterThanOrEqual(0);
  expect(entries).toHaveLength(transactions.length);
  expect(new Set(entries.map((entry) => entry.transaction_id))).toEqual(
    new Set(transactions.map((transaction) => transaction.id)),
  );

  let running = 0;
  for (const entry of entries) {
    running += entry.direction === "credit" ? entry.amount : -entry.amount;
    expect(entry.balance_after).toBe(running);
  }
  expect(running).toBe(balance);
}

export async function countRows(table: "transactions" | "ledger_entries"): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table}`,
  );
  return rows[0]?.count as number;
}
