import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { DEMO_PASSWORD } from "../../../src/db/seed/seedData.js";
import { seedDatabase } from "../../../src/db/seed/seed.js";
import { ALICE, setCookies } from "../../helpers/auth.js";
import { resetDatabase } from "../../helpers/database.js";
import {
  addAccount,
  balanceOf,
  countRows,
  createCustomerWithAccount,
  type TestCustomer,
} from "../../helpers/money.js";

describe("request hardening", () => {
  const app = createApp();
  let customer: TestCustomer;
  let otherAccount: string;

  beforeAll(async () => {
    await resetDatabase();
    await seedDatabase({ bcryptRounds: 4 });
    customer = await createCustomerWithAccount(10_000);
    otherAccount = await addAccount(customer.customerId, 0);
  });

  const depositPath = () => `/api/v1/accounts/${customer.accountId}/deposits`;

  describe("content types", () => {
    it.each([
      ["text/plain", JSON.stringify({ amount: 100 })],
      ["application/x-www-form-urlencoded", "amount=100"],
      [
        "multipart/form-data; boundary=x",
        '--x\r\nContent-Disposition: form-data; name="amount"\r\n\r\n100\r\n--x--',
      ],
      ["application/xml", "<amount>100</amount>"],
    ])("refuses a %s body with 415 and moves no money", async (contentType, body) => {
      const before = await balanceOf(customer.accountId);

      const res = await request(app)
        .post(depositPath())
        .set("Cookie", customer.cookie)
        .set("Idempotency-Key", randomUUID())
        .set("Content-Type", contentType)
        .send(body);

      expect(res.status).toBe(415);
      expect(res.body.error).toEqual({
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Request body must be JSON (Content-Type: application/json)",
        requestId: expect.any(String),
      });
      expect(await balanceOf(customer.accountId)).toBe(before);
    });

    it("refuses a form-encoded login and sets no session", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send(`email=${encodeURIComponent(ALICE.email)}&password=${DEMO_PASSWORD}`);

      expect(res.status).toBe(415);
      expect(setCookies(res)).toEqual([]);
    });

    it("accepts a body-less request whatever Content-Type it declares", async () => {
      // Some clients send a default Content-Type with `Content-Length: 0` on
      // POSTs without a body; logout must still work for them.
      const res = await request(app)
        .post("/api/v1/auth/logout")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("Content-Length", "0")
        .send("");

      expect(res.status).toBe(204);
      expect(setCookies(res).some((cookie) => cookie.startsWith("session=;"))).toBe(true);
    });

    it("refuses JSON in a charset other than UTF-8 with 415, not 500", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/json; charset=latin1")
        .send(JSON.stringify({ email: ALICE.email, password: DEMO_PASSWORD }));

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    });

    it("accepts JSON with an explicit UTF-8 charset", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/json; charset=utf-8")
        .send(JSON.stringify({ email: ALICE.email, password: DEMO_PASSWORD }));

      expect(res.status).toBe(200);
    });

    it("answers malformed JSON with the structured 400", async () => {
      const res = await request(app)
        .post(depositPath())
        .set("Cookie", customer.cookie)
        .set("Idempotency-Key", randomUUID())
        .set("Content-Type", "application/json")
        .send('{"amount": 100');

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: "INVALID_JSON",
        message: "Request body is not valid JSON",
        requestId: expect.any(String),
      });
    });

    it("answers an oversized body with 413 and moves no money", async () => {
      const before = await balanceOf(customer.accountId);

      const res = await request(app)
        .post(depositPath())
        .set("Cookie", customer.cookie)
        .set("Idempotency-Key", randomUUID())
        .send({ amount: 100, padding: "x".repeat(20_000) });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
      expect(await balanceOf(customer.accountId)).toBe(before);
    });
  });

  describe("malformed URLs", () => {
    it("answers a malformed percent-escape with 400, not 500", async () => {
      const res = await request(app)
        .get("/api/v1/accounts/%E0%A4%A")
        .set("Cookie", customer.cookie);

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: "BAD_REQUEST",
        message: "The request is malformed",
        requestId: expect.any(String),
      });
    });

    it("does not echo an unknown path back in the 404", async () => {
      const res = await request(app).get("/api/v1/%3Cscript%3Ealert(1)%3C%2Fscript%3E");

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe("Route not found");
      expect(res.text).not.toMatch(/script|alert/i);
    });
  });

  describe("HTTP methods", () => {
    const authed = (method: string, path: string) => {
      const verb = method.toLowerCase() as "get";
      const req = request(app)[verb](path);
      return req.set("Cookie", customer.cookie).set("Idempotency-Key", randomUUID());
    };

    it.each([
      ["GET", "deposits"],
      ["PUT", "deposits"],
      ["PATCH", "withdrawals"],
      ["DELETE", "withdrawals"],
      ["GET", "transfers"],
      ["PUT", "transfers"],
    ])("refuses %s on /%s with 405 and moves no money", async (method, operation) => {
      const balances = [await balanceOf(customer.accountId), await balanceOf(otherAccount)];
      const transactions = await countRows("transactions");

      const res = await authed(method, `/api/v1/accounts/${customer.accountId}/${operation}`).send({
        amount: 100,
        destinationAccountId: otherAccount,
      });

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe("POST");
      expect(res.body.error.code).toBe("METHOD_NOT_ALLOWED");
      expect([await balanceOf(customer.accountId), await balanceOf(otherAccount)]).toEqual(
        balances,
      );
      expect(await countRows("transactions")).toBe(transactions);
    });

    it.each([
      ["POST", "/api/v1/accounts"],
      ["DELETE", "/api/v1/accounts"],
      ["PUT", "/api/v1/accounts/:account"],
      ["PATCH", "/api/v1/accounts/:account"],
      ["DELETE", "/api/v1/accounts/:account"],
      ["POST", "/api/v1/transactions"],
      ["DELETE", "/api/v1/transactions"],
      ["POST", "/api/v1/auth/me"],
      ["POST", "/api/v1/health"],
    ])("refuses %s on read-only %s with 405", async (method, path) => {
      const res = await authed(method, path.replace(":account", customer.accountId)).send({});

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe("GET, HEAD");
    });

    it.each([
      ["GET", "/api/v1/auth/login"],
      ["PUT", "/api/v1/auth/login"],
      ["GET", "/api/v1/auth/logout"],
      ["DELETE", "/api/v1/auth/logout"],
    ])("refuses %s on %s with 405", async (method, path) => {
      const res = await request(app)[method.toLowerCase() as "get"](path);

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe("POST");
    });

    it("refuses TRACE", async () => {
      const res = await authed("TRACE", "/api/v1/accounts");

      expect(res.status).toBe(405);
    });

    it("still requires a session before revealing which methods exist", async () => {
      const res = await request(app).delete(`/api/v1/accounts/${customer.accountId}`);

      expect(res.status).toBe(401);
    });

    it("supports HEAD on read endpoints, without a body", async () => {
      const res = await authed("HEAD", "/api/v1/accounts");

      expect(res.status).toBe(200);
      expect(res.text).toBeFalsy();
    });
  });

  describe("parameter pollution", () => {
    it("ignores an amount in the query string: only the JSON body counts", async () => {
      const before = await balanceOf(customer.accountId);

      const res = await request(app)
        .post(`${depositPath()}?amount=99999999`)
        .set("Cookie", customer.cookie)
        .set("Idempotency-Key", randomUUID())
        .send({ amount: 100 });

      expect(res.status).toBe(201);
      expect(await balanceOf(customer.accountId)).toBe(before + 100);
    });

    it("rejects an array where a single value is expected", async () => {
      const res = await request(app)
        .post(`/api/v1/accounts/${customer.accountId}/transfers`)
        .set("Cookie", customer.cookie)
        .set("Idempotency-Key", randomUUID())
        .send({ destinationAccountId: [otherAccount, otherAccount], amount: 100 });

      expect(res.status).toBe(400);
    });

    it("rejects a repeated Idempotency-Key header", async () => {
      const res = await request(app)
        .post(depositPath())
        .set("Cookie", customer.cookie)
        // Sent as two separate header lines.
        .set("Idempotency-Key", ["first-key", "second-key"] as unknown as string)
        .send({ amount: 100 });

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].path).toBe("Idempotency-Key");
    });

    it("rejects repeated history filters", async () => {
      const res = await request(app)
        .get("/api/v1/transactions?limit=5&limit=100")
        .set("Cookie", customer.cookie);

      expect(res.status).toBe(400);
    });
  });
});
