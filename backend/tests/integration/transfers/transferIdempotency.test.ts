import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { resetDatabase } from "../../helpers/database.js";
import {
  addAccount,
  balanceOf,
  countRows,
  createCustomerWithAccount,
  expectLedgerConsistent,
  postMovement,
  postTransfer,
} from "../../helpers/money.js";

describe("idempotency of transfers", () => {
  let app: Express;

  beforeAll(async () => {
    await resetDatabase();
    app = createApp();
  });

  const expectConflict = (res: { status: number; body: { error: { code: string } } }) => {
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  };

  it("replays the original transfer and moves money once", async () => {
    const sender = await createCustomerWithAccount(10_000);
    const recipient = await createCustomerWithAccount(0);
    const options = { cookie: sender.cookie, idempotencyKey: "transfer-once" };

    const first = await postTransfer(app, sender.accountId, recipient.accountId, 3_000, options);
    const second = await postTransfer(app, sender.accountId, recipient.accountId, 3_000, options);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
    expect(await balanceOf(sender.accountId)).toBe(7_000);
    expect(await balanceOf(recipient.accountId)).toBe(3_000);
  });

  it("replays the original transfer after later, unrelated transactions", async () => {
    const sender = await createCustomerWithAccount(10_000);
    const recipient = await createCustomerWithAccount(0);
    const options = { cookie: sender.cookie, idempotencyKey: "transfer-replay-later" };

    const first = await postTransfer(app, sender.accountId, recipient.accountId, 6_000, options);
    await postMovement(
      app,
      "withdrawals",
      sender.accountId,
      { amount: 3_500 },
      {
        cookie: sender.cookie,
      },
    );
    await postMovement(
      app,
      "deposits",
      recipient.accountId,
      { amount: 100 },
      {
        cookie: recipient.cookie,
      },
    );

    // $5 left could not cover $60 again, but this is a replay, not a new transfer.
    const replay = await postTransfer(app, sender.accountId, recipient.accountId, 6_000, options);

    expect(replay.status).toBe(201);
    expect(replay.body.data.transaction).toEqual(first.body.data.transaction);
    expect(replay.body.data.transaction.balanceAfter).toBe(4_000);
    expect(replay.body.data.account.balance).toBe(500);
    expect(await balanceOf(recipient.accountId)).toBe(6_100);
  });

  it("moves money once when the same transfer arrives many times at once", async () => {
    const sender = await createCustomerWithAccount(10_000);
    const recipient = await createCustomerWithAccount(0);
    const options = { cookie: sender.cookie, idempotencyKey: "transfer-concurrent-duplicate" };
    const transactionsBefore = await countRows("transactions");

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        postTransfer(app, sender.accountId, recipient.accountId, 2_500, options),
      ),
    );

    expect(responses.every((res) => res.status === 201)).toBe(true);
    expect(responses.filter((res) => !res.headers["idempotent-replayed"])).toHaveLength(1);
    expect(new Set(responses.map((res) => res.body.data.transaction.id)).size).toBe(1);
    expect(await countRows("transactions")).toBe(transactionsBefore + 1);
    expect(await balanceOf(sender.accountId)).toBe(7_500);
    expect(await balanceOf(recipient.accountId)).toBe(2_500);
    await expectLedgerConsistent(sender.accountId);
    await expectLedgerConsistent(recipient.accountId);
  });

  it("applies only one of two simultaneous transfers that reuse a key on unrelated accounts", async () => {
    // Same customer, two sources, two destinations: the requests share no row lock.
    const sender = await createCustomerWithAccount(10_000);
    const secondSource = await addAccount(sender.customerId, 10_000);
    const [firstRecipient, secondRecipient] = await Promise.all([
      createCustomerWithAccount(0),
      createCustomerWithAccount(0),
    ]);
    const options = { cookie: sender.cookie, idempotencyKey: "transfer-key-race" };
    const transactionsBefore = await countRows("transactions");

    const responses = await Promise.all([
      postTransfer(app, sender.accountId, firstRecipient!.accountId, 1_000, options),
      postTransfer(app, secondSource, secondRecipient!.accountId, 1_000, options),
    ]);

    expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await countRows("transactions")).toBe(transactionsBefore + 1);
    expect(
      (await balanceOf(firstRecipient!.accountId)) + (await balanceOf(secondRecipient!.accountId)),
    ).toBe(1_000);
  });

  describe("reusing a key for a different request", () => {
    it("is rejected when the amount differs", async () => {
      const sender = await createCustomerWithAccount(10_000);
      const recipient = await createCustomerWithAccount(0);
      const options = { cookie: sender.cookie, idempotencyKey: "transfer-key-amount" };
      await postTransfer(app, sender.accountId, recipient.accountId, 1_000, options);

      expectConflict(
        await postTransfer(app, sender.accountId, recipient.accountId, 2_000, options),
      );
      expect(await balanceOf(recipient.accountId)).toBe(1_000);
    });

    it("is rejected when the source differs", async () => {
      const sender = await createCustomerWithAccount(10_000);
      const otherSource = await addAccount(sender.customerId, 10_000);
      const recipient = await createCustomerWithAccount(0);
      const options = { cookie: sender.cookie, idempotencyKey: "transfer-key-source" };
      await postTransfer(app, sender.accountId, recipient.accountId, 1_000, options);

      expectConflict(await postTransfer(app, otherSource, recipient.accountId, 1_000, options));
      expect(await balanceOf(otherSource)).toBe(10_000);
      expect(await balanceOf(recipient.accountId)).toBe(1_000);
    });

    it("is rejected when the destination differs", async () => {
      const sender = await createCustomerWithAccount(10_000);
      const recipient = await createCustomerWithAccount(0);
      const otherRecipient = await createCustomerWithAccount(0);
      const options = { cookie: sender.cookie, idempotencyKey: "transfer-key-destination" };
      await postTransfer(app, sender.accountId, recipient.accountId, 1_000, options);

      expectConflict(
        await postTransfer(app, sender.accountId, otherRecipient.accountId, 1_000, options),
      );
      expect(await balanceOf(otherRecipient.accountId)).toBe(0);
      expect(await balanceOf(sender.accountId)).toBe(9_000);
    });

    it("is rejected when the key was first used for a withdrawal", async () => {
      const sender = await createCustomerWithAccount(10_000);
      const recipient = await createCustomerWithAccount(0);
      const options = { cookie: sender.cookie, idempotencyKey: "withdrawal-then-transfer" };
      await postMovement(app, "withdrawals", sender.accountId, { amount: 1_000 }, options);

      expectConflict(
        await postTransfer(app, sender.accountId, recipient.accountId, 1_000, options),
      );
      expect(await balanceOf(recipient.accountId)).toBe(0);
    });

    it("is rejected when a transfer's key is reused for a deposit", async () => {
      const sender = await createCustomerWithAccount(10_000);
      const recipient = await createCustomerWithAccount(0);
      const options = { cookie: sender.cookie, idempotencyKey: "transfer-then-deposit" };
      await postTransfer(app, sender.accountId, recipient.accountId, 1_000, options);

      expectConflict(
        await postMovement(app, "deposits", sender.accountId, { amount: 1_000 }, options),
      );
      expect(await balanceOf(sender.accountId)).toBe(9_000);
    });
  });

  it("keeps each customer's keys separate", async () => {
    const alice = await createCustomerWithAccount(10_000);
    const bob = await createCustomerWithAccount(10_000);

    const aliceRes = await postTransfer(app, alice.accountId, bob.accountId, 1_000, {
      cookie: alice.cookie,
      idempotencyKey: "shared-transfer-key",
    });
    const bobRes = await postTransfer(app, bob.accountId, alice.accountId, 300, {
      cookie: bob.cookie,
      idempotencyKey: "shared-transfer-key",
    });

    expect(aliceRes.status).toBe(201);
    expect(bobRes.status).toBe(201);
    expect(bobRes.headers["idempotent-replayed"]).toBeUndefined();
    expect(await balanceOf(alice.accountId)).toBe(9_300);
    expect(await balanceOf(bob.accountId)).toBe(10_700);
  });

  it("does not consume a key when the destination does not exist", async () => {
    const sender = await createCustomerWithAccount(10_000);
    const recipient = await createCustomerWithAccount(0);
    const options = { cookie: sender.cookie, idempotencyKey: "missing-destination-then-retry" };

    const refused = await postTransfer(
      app,
      sender.accountId,
      "00000000-0000-4000-8000-00000000dead",
      1_000,
      options,
    );
    expect(refused.status).toBe(422);

    const retried = await postTransfer(app, sender.accountId, recipient.accountId, 1_000, options);
    expect(retried.status).toBe(201);
    expect(retried.headers["idempotent-replayed"]).toBeUndefined();
  });
});
