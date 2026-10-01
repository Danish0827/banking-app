import { once } from "node:events";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShutdownHandler } from "../../src/shutdown.js";

const quietLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path, agent: false }, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on("error", reject);
  });
}

/** A fake server whose close() calls back only when told to. */
function controllableServer() {
  let finishClose: ((err?: Error) => void) | undefined;
  return {
    server: {
      close: vi.fn((callback?: (err?: Error) => void) => {
        finishClose = callback;
        return undefined as unknown as Server;
      }),
      closeAllConnections: vi.fn(),
    },
    finishClose: (err?: Error) => finishClose?.(err),
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("graceful shutdown", () => {
  let server: Server | undefined;

  afterEach(() => {
    if (server?.listening) server.close();
    vi.clearAllMocks();
  });

  it("finishes in-flight requests, refuses new ones, then closes the database and exits 0", async () => {
    const events: string[] = [];
    let releaseSlowRequest: () => void = () => {};
    const app = express().get("/slow", (_req, res) => {
      events.push("slow request started");
      releaseSlowRequest = () => {
        events.push("slow request finished");
        res.send("done");
      };
    });
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => (resolveExit = resolve));
    const shutdown = createShutdownHandler({
      server,
      closeDatabase: async () => {
        events.push("database closed");
      },
      logger: quietLogger,
      timeoutMs: 5_000,
      exit: (code) => {
        events.push(`exit ${code}`);
        resolveExit(code);
      },
      onShutdownStart: () => events.push("marked not ready"),
    });

    // A request is in flight when the signal arrives.
    const inFlight = get(port, "/slow");
    while (!events.includes("slow request started")) await flush();
    shutdown("SIGTERM");

    // New connections are refused while the old request is still running.
    await expect(get(port, "/slow")).rejects.toMatchObject({ code: "ECONNREFUSED" });
    events.push("new request refused");

    // The in-flight request still completes normally.
    releaseSlowRequest();
    expect(await inFlight).toEqual({ status: 200, body: "done" });

    expect(await exited).toBe(0);
    expect(events).toEqual([
      "slow request started",
      "marked not ready",
      "new request refused",
      "slow request finished",
      "database closed",
      "exit 0",
    ]);
  });

  it("closes the database only after the HTTP server has stopped", async () => {
    const { server: fake, finishClose } = controllableServer();
    const closeDatabase = vi.fn(() => Promise.resolve());
    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      server: fake,
      closeDatabase,
      logger: quietLogger,
      timeoutMs: 5_000,
      exit,
    });

    shutdown("SIGTERM");
    await flush();
    expect(fake.close).toHaveBeenCalledOnce();
    expect(closeDatabase).not.toHaveBeenCalled();

    finishClose();
    await flush();
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("cuts remaining connections and exits 1 if requests outlast the timeout", async () => {
    const { server: fake } = controllableServer(); // close() never completes
    const closeDatabase = vi.fn(() => Promise.resolve());
    const exited = new Promise<number>((resolve) => {
      createShutdownHandler({
        server: fake,
        closeDatabase,
        logger: quietLogger,
        timeoutMs: 50,
        exit: resolve,
      })("SIGTERM");
    });

    expect(await exited).toBe(1);
    expect(fake.closeAllConnections).toHaveBeenCalledOnce();
    expect(quietLogger.error).toHaveBeenCalledWith(
      { timeoutMs: 50 },
      "Shutdown timed out: closing remaining connections",
    );
  });

  it("ignores repeated signals", () => {
    const { server: fake } = controllableServer();
    const shutdown = createShutdownHandler({
      server: fake,
      closeDatabase: () => Promise.resolve(),
      logger: quietLogger,
      timeoutMs: 5_000,
      exit: vi.fn(),
    });

    shutdown("SIGTERM");
    shutdown("SIGINT");
    shutdown("SIGTERM");

    expect(fake.close).toHaveBeenCalledOnce();
    expect(quietLogger.warn).toHaveBeenCalledTimes(2);
  });

  it("exits 1 if closing the database fails", async () => {
    const { server: fake, finishClose } = controllableServer();
    const exit = vi.fn();
    createShutdownHandler({
      server: fake,
      closeDatabase: () => Promise.reject(new Error("pool end failed")),
      logger: quietLogger,
      timeoutMs: 5_000,
      exit,
    })("SIGTERM");

    finishClose();
    await flush();

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still closes the database, then exits 1, if the server reports an error", async () => {
    const { server: fake, finishClose } = controllableServer();
    const closeDatabase = vi.fn(() => Promise.resolve());
    const exit = vi.fn();
    createShutdownHandler({
      server: fake,
      closeDatabase,
      logger: quietLogger,
      timeoutMs: 5_000,
      exit,
    })("SIGTERM");

    finishClose(new Error("server not running"));
    await flush();

    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
