import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { pool } from "../../src/db/pool.js";
import { deposit, withdraw } from "../../src/modules/transactions/transaction.service.js";
import { transfer } from "../../src/modules/transactions/transfer.service.js";

/** GET /api/v1/transactions with the given query parameters. */
export function getHistory(app: Express, cookie?: string, query: Record<string, string> = {}) {
  const req = request(app).get("/api/v1/transactions").query(query);
  return cookie ? req.set("Cookie", cookie) : req;
}

/**
 * Money movements through the real service layer (so balances, transactions
 * and ledger entries are all written as in production). Each returns the
 * transaction id.
 */
export const activity = {
  async deposit(customerId: string, accountId: string, amount: number): Promise<string> {
    const result = await deposit(
      { customerId },
      { accountId, amount, idempotencyKey: randomUUID() },
    );
    return result.transaction.id;
  },
  async withdraw(customerId: string, accountId: string, amount: number): Promise<string> {
    const result = await withdraw(
      { customerId },
      { accountId, amount, idempotencyKey: randomUUID() },
    );
    return result.transaction.id;
  },
  async transfer(
    customerId: string,
    sourceAccountId: string,
    destinationAccountId: string,
    amount: number,
  ): Promise<string> {
    const result = await transfer(
      { customerId },
      { sourceAccountId, destinationAccountId, amount, idempotencyKey: randomUUID() },
    );
    return result.transaction.id;
  },
};

/**
 * The database's current time, for date-range boundaries. A short pause on
 * either side keeps it strictly between the transactions around it.
 */
export async function timeMarker(): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  const { rows } = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  await new Promise((resolve) => setTimeout(resolve, 20));
  return (rows[0] as { now: Date }).now.toISOString();
}
