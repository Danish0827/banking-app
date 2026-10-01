import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { securityHeaders } from "../../../src/middleware/securityHeaders.js";
import { resetDatabase } from "../../helpers/database.js";
import { createCustomerWithAccount, type TestCustomer } from "../../helpers/money.js";

describe("security headers", () => {
  const app = createApp();
  let customer: TestCustomer;

  beforeAll(async () => {
    await resetDatabase();
    customer = await createCustomerWithAccount(1_000);
  });

  // A public endpoint, an authenticated read, an error and an unknown route.
  const responses = () =>
    Promise.all([
      request(app).get("/api/v1/health"),
      request(app).get("/api/v1/accounts").set("Cookie", customer.cookie),
      request(app).get("/api/v1/accounts"),
      request(app).get("/api/v1/does-not-exist"),
    ]);

  it("sends a CSP that lets a JSON response load nothing and be framed nowhere", async () => {
    for (const res of await responses()) {
      expect(res.headers["content-security-policy"]).toBe(
        "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'",
      );
    }
  });

  it("forbids framing, MIME sniffing and referrers on every response", async () => {
    for (const res of await responses()) {
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    }
  });

  it("disables powerful browser features", async () => {
    const [res] = await responses();

    expect(res?.headers["permissions-policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
  });

  it("does not advertise the server framework", async () => {
    for (const res of await responses()) {
      expect(res.headers["x-powered-by"]).toBeUndefined();
    }
  });

  it("keeps API responses out of caches", async () => {
    for (const res of await responses()) {
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("sends HSTS only in production", async () => {
    const appWith = (production: boolean) =>
      express()
        .use(securityHeaders({ production }))
        .get("/", (_req, res) => {
          res.json({});
        });

    const production = await request(appWith(true)).get("/");
    const development = await request(appWith(false)).get("/");

    expect(production.headers["strict-transport-security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(development.headers["strict-transport-security"]).toBeUndefined();
    // The test app runs as NODE_ENV=test, so it must not send HSTS either.
    expect((await request(app).get("/api/v1/health")).headers["strict-transport-security"]).toBe(
      undefined,
    );
  });
});
