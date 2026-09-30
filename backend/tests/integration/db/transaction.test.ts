import type pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../../src/config/env.js";
import { createPool, pool, type Queryable } from "../../../src/db/pool.js";
import { withTransaction } from "../../../src/db/transaction.js";
import { resetDatabase } from "../../helpers/database.js";

function insertCustomer(db: Queryable, email: string) {
  return db.query(
    `INSERT INTO customers (email, full_name, password_hash)
     VALUES ($1, 'Test Customer', 'not-a-real-hash')`,
    [email],
  );
}

async function customerEmails(): Promise<string[]> {
  const { rows } = await pool.query<{ email: string }>(
    "SELECT email FROM customers ORDER BY email",
  );
  return rows.map((row) => row.email);
}

describe("withTransaction", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe("commit", () => {
    it("persists the work and returns the callback's result", async () => {
      const result = await withTransaction(async (client) => {
        await insertCustomer(client, "a@example.com");
        await insertCustomer(client, "b@example.com");
        return "done";
      });

      expect(result).toBe("done");
      expect(await customerEmails()).toEqual(["a@example.com", "b@example.com"]);
    });

    it("keeps uncommitted work invisible to other connections until COMMIT", async () => {
      await withTransaction(async (client) => {
        await insertCustomer(client, "a@example.com");

        // `pool.query` runs on a different connection, outside the transaction.
        expect(await customerEmails()).toEqual([]);
      });

      expect(await customerEmails()).toEqual(["a@example.com"]);
    });
  });

  describe("rollback", () => {
    it("discards all work and rethrows when the callback throws", async () => {
      const failure = new Error("business rule violated");

      await expect(
        withTransaction(async (client) => {
          await insertCustomer(client, "a@example.com");
          await insertCustomer(client, "b@example.com");
          throw failure;
        }),
      ).rejects.toBe(failure);

      expect(await customerEmails()).toEqual([]);
    });

    it("discards earlier statements when a later statement fails in the database", async () => {
      await expect(
        withTransaction(async (client) => {
          await insertCustomer(client, "a@example.com");
          await insertCustomer(client, "A@EXAMPLE.COM"); // violates the unique email constraint
        }),
      ).rejects.toMatchObject({ code: "23505", constraint: "customers_email_key" });

      expect(await customerEmails()).toEqual([]);
    });

    it("leaves previously committed data untouched", async () => {
      await insertCustomer(pool, "existing@example.com");

      await expect(
        withTransaction(async (client) => {
          await client.query("UPDATE customers SET full_name = 'Changed'");
          await insertCustomer(client, "a@example.com");
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      const { rows } = await pool.query<{ email: string; full_name: string }>(
        "SELECT email, full_name FROM customers",
      );
      expect(rows).toEqual([{ email: "existing@example.com", full_name: "Test Customer" }]);
    });
  });

  describe("connection handling", () => {
    it("runs every statement on one connection, inside one transaction", async () => {
      const seen = await withTransaction(async (client) => {
        const sql = "SELECT pg_backend_pid() AS pid, txid_current() AS txid";
        const first = await client.query<{ pid: number; txid: number }>(sql);
        const second = await client.query<{ pid: number; txid: number }>(sql);
        return [first.rows[0], second.rows[0]];
      });

      expect(seen[0]).toEqual(seen[1]);
    });

    it("releases the client after both commit and rollback", async () => {
      // With a single connection, a leaked client would make the next
      // transaction wait forever for one to become available.
      const singleConnectionPool = createPool(env.DATABASE_URL, 1);

      try {
        await expect(
          withTransaction(async () => {
            throw new Error("boom");
          }, singleConnectionPool),
        ).rejects.toThrow("boom");

        await withTransaction(
          (client) => insertCustomer(client, "a@example.com"),
          singleConnectionPool,
        );
        await withTransaction(
          (client) => insertCustomer(client, "b@example.com"),
          singleConnectionPool,
        );

        expect(singleConnectionPool.totalCount).toBe(1);
        expect(singleConnectionPool.idleCount).toBe(1);
        expect(singleConnectionPool.waitingCount).toBe(0);
      } finally {
        await singleConnectionPool.end();
      }

      expect(await customerEmails()).toEqual(["a@example.com", "b@example.com"]);
    });
  });

  describe("statement order (with a stubbed client)", () => {
    function stubPool(failOn?: string) {
      const statements: string[] = [];
      const release = vi.fn();
      const client = {
        query: vi.fn(async (sql: string) => {
          statements.push(sql);
          if (sql === failOn) throw new Error(`${sql} failed`);
          return { rows: [] };
        }),
        release,
      };
      const db = { connect: async () => client } as unknown as pg.Pool;
      return { db, statements, release };
    }

    it("issues BEGIN, the work, then COMMIT, and releases once", async () => {
      const { db, statements, release } = stubPool();

      await withTransaction(async (client) => {
        await client.query("SELECT 1");
      }, db);

      expect(statements).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
      expect(release).toHaveBeenCalledExactlyOnceWith(false);
    });

    it("issues ROLLBACK instead of COMMIT on error, and still releases", async () => {
      const { db, statements, release } = stubPool();

      await expect(
        withTransaction(async () => {
          throw new Error("boom");
        }, db),
      ).rejects.toThrow("boom");

      expect(statements).toEqual(["BEGIN", "ROLLBACK"]);
      expect(release).toHaveBeenCalledExactlyOnceWith(false);
    });

    it("rolls back when COMMIT itself fails", async () => {
      const { db, statements, release } = stubPool("COMMIT");

      await expect(withTransaction(async () => "done", db)).rejects.toThrow("COMMIT failed");

      expect(statements).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
      expect(release).toHaveBeenCalledOnce();
    });

    it("rethrows the original error and discards the client when ROLLBACK fails", async () => {
      const { db, release } = stubPool("ROLLBACK");

      await expect(
        withTransaction(async () => {
          throw new Error("original failure");
        }, db),
      ).rejects.toThrow("original failure");

      // `release(true)` destroys the connection instead of reusing it.
      expect(release).toHaveBeenCalledExactlyOnceWith(true);
    });
  });
});
