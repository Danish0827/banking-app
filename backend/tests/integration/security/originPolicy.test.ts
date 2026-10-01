import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { DEMO_PASSWORD } from "../../../src/db/seed/seedData.js";
import { seedDatabase } from "../../../src/db/seed/seed.js";
import { ALICE, setCookies } from "../../helpers/auth.js";
import { resetDatabase } from "../../helpers/database.js";
import { balanceOf, createCustomerWithAccount, type TestCustomer } from "../../helpers/money.js";

const TRUSTED = "https://app.example.com";
const EVIL = "https://evil.example";

describe("CORS and cross-origin request policy", () => {
  // Default configuration: no trusted origins (the web app uses its own proxy).
  const defaultApp = createApp();
  const configuredApp = createApp({ corsAllowedOrigins: [TRUSTED] });
  let customer: TestCustomer;

  beforeAll(async () => {
    await resetDatabase();
    await seedDatabase({ bcryptRounds: 4 });
    customer = await createCustomerWithAccount(10_000);
  });

  const loginBody = { email: ALICE.email, password: DEMO_PASSWORD };

  function deposit(app: typeof defaultApp, origin?: string) {
    const req = request(app)
      .post(`/api/v1/accounts/${customer.accountId}/deposits`)
      .set("Cookie", customer.cookie)
      .set("Idempotency-Key", randomUUID());
    if (origin) req.set("Origin", origin);
    return req.send({ amount: 100 });
  }

  describe("CORS response headers", () => {
    it("sends no CORS headers to requests without an Origin", async () => {
      const res = await request(configuredApp).get("/api/v1/health");

      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("allows a configured origin with credentials, echoing it exactly", async () => {
      const res = await request(configuredApp).get("/api/v1/health").set("Origin", TRUSTED);

      expect(res.headers["access-control-allow-origin"]).toBe(TRUSTED);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
      expect(res.headers.vary).toMatch(/Origin/);
    });

    it.each([
      ["an unknown origin", EVIL],
      ["a look-alike origin", "https://app.example.com.evil.example"],
      ["the trusted host over http", "http://app.example.com"],
      ["the trusted host on another port", "https://app.example.com:8443"],
      ["the null origin", "null"],
    ])("gives %s no CORS access", async (_label, origin) => {
      const res = await request(configuredApp).get("/api/v1/health").set("Origin", origin);

      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    });

    it("never answers with a wildcard origin", async () => {
      for (const origin of [TRUSTED, EVIL]) {
        for (const app of [defaultApp, configuredApp]) {
          const res = await request(app).get("/api/v1/health").set("Origin", origin);
          expect(res.headers["access-control-allow-origin"]).not.toBe("*");
        }
      }
    });

    it("gives no origin CORS access when none is configured", async () => {
      const res = await request(defaultApp).get("/api/v1/health").set("Origin", TRUSTED);

      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("preflight requests", () => {
    const preflight = (app: typeof defaultApp, origin: string) =>
      request(app)
        .options(`/api/v1/accounts/${customer.accountId}/transfers`)
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "content-type, idempotency-key");

    it("approves a configured origin for the methods and headers the API uses", async () => {
      const res = await preflight(configuredApp, TRUSTED);

      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(TRUSTED);
      expect(res.headers["access-control-allow-methods"]).toBe("GET, HEAD, POST");
      expect(res.headers["access-control-allow-headers"]).toBe(
        "Content-Type, Idempotency-Key, X-Request-Id",
      );
      expect(res.headers["access-control-max-age"]).toBe("600");
    });

    it("refuses any other origin", async () => {
      for (const app of [defaultApp, configuredApp]) {
        const res = await preflight(app, EVIL);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      }
    });
  });

  describe("cross-site writes (CSRF)", () => {
    it("refuses a login posted from another origin and sets no session", async () => {
      const res = await request(defaultApp)
        .post("/api/v1/auth/login")
        .set("Origin", EVIL)
        .send(loginBody);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
      expect(setCookies(res)).toEqual([]);
    });

    it("refuses a money movement posted from another origin and moves nothing", async () => {
      const before = await balanceOf(customer.accountId);

      for (const origin of [EVIL, "null", "http://localhost:9999"]) {
        const res = await deposit(defaultApp, origin);
        expect(res.status).toBe(403);
      }

      expect(await balanceOf(customer.accountId)).toBe(before);
    });

    it("allows writes from the app's own origin through the proxy", async () => {
      const res = await request(defaultApp)
        .post("/api/v1/auth/login")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-Host", "localhost:3000")
        .send(loginBody);

      expect(res.status).toBe(200);
    });

    it("allows writes from the API's own origin", async () => {
      const res = await request(defaultApp)
        .post("/api/v1/auth/login")
        .set("Host", "bank.example")
        .set("Origin", "https://bank.example")
        .send(loginBody);

      expect(res.status).toBe(200);
    });

    it("allows writes from a configured origin", async () => {
      const before = await balanceOf(customer.accountId);

      const res = await deposit(configuredApp, TRUSTED);

      expect(res.status).toBe(201);
      expect(res.headers["access-control-allow-origin"]).toBe(TRUSTED);
      expect(await balanceOf(customer.accountId)).toBe(before + 100);
    });

    it("allows writes without an Origin header (non-browser clients)", async () => {
      expect((await deposit(defaultApp)).status).toBe(201);
    });

    it("still answers reads from other origins, without granting CORS access", async () => {
      const res = await request(defaultApp)
        .get("/api/v1/accounts")
        .set("Origin", EVIL)
        .set("Cookie", customer.cookie);

      // The browser will not let the other site read this response.
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});
