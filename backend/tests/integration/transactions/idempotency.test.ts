import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { pool } from "../../../src/db/pool.js";
import { resetDatabase } from "../../helpers/database.js";
import { createAccount } from "../../helpers/fixtures.js";
import {
  balanceOf,
  countRows,
  createCustomerWithAccount,
  expectLedgerConsistent,
  postMovement,
  recordsFor,
} from "../../helpers/money.js";

describe("idempotency of deposits and withdrawals", () => {
  let app: Express;

  beforeAll(async () => {
    await resetDatabase();
    app = createApp();
  });

  it("returns the original result for a repeated request and moves money once", async () => {
    const { accountId, cookie } = await createCustomerWithAccount(0);
    const options = { cookie, idempotencyKey: "deposit-once" };

    const first = await postMovement(app, "deposits", accountId, { amount: 1_000 }, options);
    const second = await postMovement(app, "deposits", accountId, { amount: 1_000 }, options);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);

    expect(await balanceOf(accountId)).toBe(1_000);
    expect((await recordsFor(accountId)).transactions).toHaveLength(1);
    await expectLedgerConsistent(accountId);
  });

  it("replays the original transaction even after later movements", async () => {
    const { accountId, cookie } = await createCustomerWithAccount(10_000);
    const options = { cookie, idempotencyKey: "withdraw-once" };

    const first = await postMovement(app, "withdrawals", accountId, { amount: 6_000 }, options);
    await postMovement(app, "withdrawals", accountId, { amount: 3_000 }, { cookie });

    // The balance ($10) could no longer cover it, but this is a replay, not a new withdrawal.
    const replay = await postMovement(app, "withdrawals", accountId, { amount: 6_000 }, options);

    expect(replay.status).toBe(201);
    expect(replay.body.data.transaction).toEqual(first.body.data.transaction);
    expect(replay.body.data.transaction.balanceAfter).toBe(4_000);
    expect(replay.body.data.account.balance).toBe(1_000); // the account as it is now
    expect(await balanceOf(accountId)).toBe(1_000);
  });

  it("moves money once when the same request arrives many times at once", async () => {
    const { accountId, cookie } = await createCustomerWithAccount(10_000);
    const options = { cookie, idempotencyKey: "concurrent-duplicate" };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        postMovement(app, "withdrawals", accountId, { amount: 2_500 }, options),
      ),
    );

    expect(responses.every((res) => res.status === 201)).toBe(true);
    expect(responses.filter((res) => !res.headers["idempotent-replayed"])).toHaveLength(1);
    expect(new Set(responses.map((res) => res.body.data.transaction.id)).size).toBe(1);

    expect(await balanceOf(accountId)).toBe(7_500);
    const { transactions } = await recordsFor(accountId);
    expect(transactions.filter((t) => t.type === "withdrawal")).toHaveLength(1);
    await expectLedgerConsistent(accountId);
  });

  it("applies only one of two simultaneous requests that reuse a key on different accounts", async () => {
    const { customerId, accountId, cookie } = await createCustomerWithAccount(0);
    const otherAccountId = await createAccount(customerId);
    const options = { cookie, idempotencyKey: "shared-across-accounts" };
    const transactionsBefore = await countRows("transactions");

    const responses = await Promise.all([
      postMovement(app, "deposits", accountId, { amount: 500 }, options),
      postMovement(app, "deposits", otherAccountId, { amount: 500 }, options),
    ]);

    expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(responses.find((res) => res.status === 409)?.body.error.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );
    expect(await countRows("transactions")).toBe(transactionsBefore + 1);
    expect((await balanceOf(accountId)) + (await balanceOf(otherAccountId))).toBe(500);
  });

  describe("reusing a key for a different request", () => {
    const expectConflict = (res: { status: number; body: { error: unknown } }) => {
      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({
        code: "IDEMPOTENCY_CONFLICT",
        message: "This Idempotency-Key was already used for a different request",
        requestId: expect.any(String),
      });
    };

    it("is rejected when the amount differs", async () => {
      const { accountId, cookie } = await createCustomerWithAccount(0);
      const options = { cookie, idempotencyKey: "key-amount" };
      await postMovement(app, "deposits", accountId, { amount: 1_000 }, options);

      expectConflict(await postMovement(app, "deposits", accountId, { amount: 2_000 }, options));
      expect(await balanceOf(accountId)).toBe(1_000);
    });

    it("is rejected when the account differs", async () => {
      const { customerId, accountId, cookie } = await createCustomerWithAccount(0);
      const otherAccountId = await createAccount(customerId);
      const options = { cookie, idempotencyKey: "key-account" };
      await postMovement(app, "deposits", accountId, { amount: 1_000 }, options);

      expectConflict(
        await postMovement(app, "deposits", otherAccountId, { amount: 1_000 }, options),
      );
      expect(await balanceOf(otherAccountId)).toBe(0);
    });

    it("is rejected when the operation differs: a deposit key never moves money out", async () => {
      const { accountId, cookie } = await createCustomerWithAccount(0);
      const options = { cookie, idempotencyKey: "key-operation" };
      await postMovement(app, "deposits", accountId, { amount: 1_000 }, options);

      expectConflict(await postMovement(app, "withdrawals", accountId, { amount: 1_000 }, options));
      expect(await balanceOf(accountId)).toBe(1_000);
      expect((await recordsFor(accountId)).transactions).toHaveLength(1);
    });

    it("is rejected when a withdrawal key is reused for a deposit", async () => {
      const { accountId, cookie } = await createCustomerWithAccount(5_000);
      const options = { cookie, idempotencyKey: "key-operation-reverse" };
      await postMovement(app, "withdrawals", accountId, { amount: 1_000 }, options);

      expectConflict(await postMovement(app, "deposits", accountId, { amount: 1_000 }, options));
      expect(await balanceOf(accountId)).toBe(4_000);
    });
  });

  it("keeps each customer's keys separate", async () => {
    const alice = await createCustomerWithAccount(0);
    const bob = await createCustomerWithAccount(0);

    const aliceRes = await postMovement(
      app,
      "deposits",
      alice.accountId,
      { amount: 100 },
      {
        cookie: alice.cookie,
        idempotencyKey: "same-key-different-customers",
      },
    );
    const bobRes = await postMovement(
      app,
      "deposits",
      bob.accountId,
      { amount: 200 },
      {
        cookie: bob.cookie,
        idempotencyKey: "same-key-different-customers",
      },
    );

    expect(aliceRes.status).toBe(201);
    expect(bobRes.status).toBe(201);
    expect(bobRes.headers["idempotent-replayed"]).toBeUndefined();
    expect(await balanceOf(alice.accountId)).toBe(100);
    expect(await balanceOf(bob.accountId)).toBe(200);
  });

  it("does not consume a key when the request is refused", async () => {
    const { accountId, cookie } = await createCustomerWithAccount(1_000);
    const options = { cookie, idempotencyKey: "refused-then-retried" };

    const refused = await postMovement(app, "withdrawals", accountId, { amount: 5_000 }, options);
    expect(refused.status).toBe(422);

    await postMovement(app, "deposits", accountId, { amount: 9_000 }, { cookie });
    const retried = await postMovement(app, "withdrawals", accountId, { amount: 5_000 }, options);

    expect(retried.status).toBe(201);
    expect(retried.headers["idempotent-replayed"]).toBeUndefined();
    expect(await balanceOf(accountId)).toBe(5_000);
  });

  it("stores the key with the transaction it produced", async () => {
    const { accountId, cookie } = await createCustomerWithAccount(0);

    const res = await postMovement(
      app,
      "deposits",
      accountId,
      { amount: 100 },
      {
        cookie,
        idempotencyKey: "stored-key",
      },
    );

    const { rows } = await pool.query("SELECT idempotency_key FROM transactions WHERE id = $1", [
      res.body.data.transaction.id,
    ]);
    expect(rows).toEqual([{ idempotency_key: "stored-key" }]);
  });
});
