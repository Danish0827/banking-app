import type { Express } from "express";
import { SignJWT } from "jose";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { seedDatabase } from "../../../src/db/seed/seed.js";
import { DEMO_PASSWORD } from "../../../src/db/seed/seedData.js";
import { LOGIN_MAX_FAILED_ATTEMPTS } from "../../../src/modules/auth/loginRateLimiter.js";
import { createSessionToken } from "../../../src/modules/auth/session.js";
import {
  ALICE,
  BOB,
  cookieHeader,
  login,
  sessionSetCookie,
  sessionToken,
  setCookies,
} from "../../helpers/auth.js";
import { resetDatabase } from "../../helpers/database.js";

const ALICE_CUSTOMER = { id: ALICE.id, email: ALICE.email, fullName: ALICE.fullName };
const UNKNOWN_CUSTOMER_ID = "00000000-0000-4000-8000-00000000dead";

function decodeJwtPart(token: string, index: number): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[index] as string, "base64url").toString());
}

function me(app: Express, token?: string) {
  const req = request(app).get("/api/v1/auth/me");
  return token === undefined ? req : req.set("Cookie", cookieHeader(token));
}

describe("authentication", () => {
  // A fresh app per test gives each test its own rate-limit counters.
  let app: Express;

  beforeAll(async () => {
    await resetDatabase();
    await seedDatabase({ bcryptRounds: 4 });
  });

  beforeEach(() => {
    app = createApp();
  });

  describe("POST /api/v1/auth/login", () => {
    it("logs in with a valid email and password and returns the customer", async () => {
      const res = await login(app, ALICE.email);

      expect(res.status).toBe(200);
      // Exact match: no password hash or any other field may be present.
      expect(res.body).toEqual({ data: { customer: ALICE_CUSTOMER } });
      expect(sessionSetCookie(res)).toBeDefined();
    });

    it("matches the email case-insensitively and ignores surrounding whitespace", async () => {
      const res = await login(app, `  ${ALICE.email.toUpperCase()}  `);

      expect(res.status).toBe(200);
      expect(res.body.data.customer).toEqual(ALICE_CUSTOMER);
    });

    it("rejects a wrong password with 401 and sets no cookie", async () => {
      const res = await login(app, ALICE.email, "wrong-password");

      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
        requestId: expect.any(String),
      });
      expect(setCookies(res)).toEqual([]);
    });

    it("responds to an unknown email exactly as it does to a wrong password", async () => {
      const wrongPassword = await login(app, ALICE.email, "wrong-password");
      const unknownEmail = await login(app, "nobody@example.com", DEMO_PASSWORD);

      expect(unknownEmail.status).toBe(wrongPassword.status);
      expect({ ...unknownEmail.body.error, requestId: null }).toEqual({
        ...wrongPassword.body.error,
        requestId: null,
      });
      expect(setCookies(unknownEmail)).toEqual([]);
    });

    it.each([
      ["a missing email", { password: "x" }, ["email"]],
      ["a missing password", { email: ALICE.email }, ["password"]],
      ["an empty body", {}, ["email", "password"]],
      ["a malformed email", { email: "not-an-email", password: "x" }, ["email"]],
      ["an empty password", { email: ALICE.email, password: "" }, ["password"]],
      ["a non-string password", { email: ALICE.email, password: 12345 }, ["password"]],
      ["an over-long password", { email: ALICE.email, password: "x".repeat(129) }, ["password"]],
    ])("rejects %s with 400", async (_label, body, invalidFields) => {
      const res = await request(app).post("/api/v1/auth/login").send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details.map((detail: { path: string }) => detail.path)).toEqual(
        invalidFields,
      );
      expect(setCookies(res)).toEqual([]);
    });

    it("rejects a request with no JSON body with 400", async () => {
      const res = await request(app).post("/api/v1/auth/login");

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("does not echo submitted values in validation errors", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "not-an-email", password: "my-secret-password" });

      expect(JSON.stringify(res.body)).not.toContain("my-secret-password");
    });

    it("tells caches not to store the response", async () => {
      const res = await login(app, ALICE.email);

      expect(res.headers["cache-control"]).toBe("no-store");
    });
  });

  describe("session cookie", () => {
    it("is HttpOnly, SameSite=Lax, scoped to / and expires with the session", async () => {
      const cookie = sessionSetCookie(await login(app, ALICE.email)) as string;
      const attributes = cookie.split("; ").slice(1);

      expect(attributes).toContain("HttpOnly");
      expect(attributes).toContain("SameSite=Lax");
      expect(attributes).toContain("Path=/");
      expect(attributes).toContain("Max-Age=3600");
      expect(attributes.some((attribute) => attribute.startsWith("Domain="))).toBe(false);
      // Secure is only set in production (covered in tests/unit/session.test.ts).
      expect(attributes).not.toContain("Secure");
    });

    it("holds a signed token that carries only the customer id and its validity", async () => {
      const token = sessionToken(await login(app, ALICE.email));

      expect(decodeJwtPart(token, 0)).toEqual({ alg: "HS256" });

      const payload = decodeJwtPart(token, 1);
      expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "iss", "sub"]);
      expect(payload.sub).toBe(ALICE.id);
      expect((payload.exp as number) - (payload.iat as number)).toBe(3600);
    });
  });

  describe("GET /api/v1/auth/me", () => {
    it("returns the authenticated customer", async () => {
      const token = sessionToken(await login(app, ALICE.email));

      const res = await me(app, token);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { customer: ALICE_CUSTOMER } });
    });

    it("identifies each customer by their own session", async () => {
      const token = sessionToken(await login(app, BOB.email));

      const res = await me(app, token);

      expect(res.body.data.customer.email).toBe(BOB.email);
    });

    const expectUnauthenticated = (res: request.Response) => {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required",
          requestId: expect.any(String),
        },
      });
    };

    it("returns 401 without a session", async () => {
      expectUnauthenticated(await me(app));
    });

    it("returns 401 for a cookie that is not a token", async () => {
      expectUnauthenticated(await me(app, "not-a-jwt"));
    });

    it("returns 401 for a token whose signature has been tampered with", async () => {
      const token = sessionToken(await login(app, ALICE.email));
      const [header, , signature] = token.split(".");
      const forgedPayload = Buffer.from(
        JSON.stringify({ ...decodeJwtPart(token, 1), sub: BOB.id }),
      ).toString("base64url");

      expectUnauthenticated(await me(app, `${header}.${forgedPayload}.${signature}`));
    });

    it("returns 401 for a token signed with a different key", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT()
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("banking-app")
        .setSubject(ALICE.id)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(new TextEncoder().encode("a-different-secret-of-sufficient-length"));

      expectUnauthenticated(await me(app, token));
    });

    it("returns 401 for an unsigned (alg: none) token", async () => {
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const token = `${encode({ alg: "none" })}.${encode({
        iss: "banking-app",
        sub: ALICE.id,
        iat: now,
        exp: now + 3600,
      })}.`;

      expectUnauthenticated(await me(app, token));
    });

    it("returns 401 for an expired session", async () => {
      const expired = await createSessionToken(ALICE.id, -60);

      expectUnauthenticated(await me(app, expired));
    });

    it("returns 401 when the customer no longer exists", async () => {
      const token = await createSessionToken(UNKNOWN_CUSTOMER_ID);

      expectUnauthenticated(await me(app, token));
    });
  });

  describe("POST /api/v1/auth/logout", () => {
    it("returns 204 and clears the session cookie", async () => {
      const token = sessionToken(await login(app, ALICE.email));

      const res = await request(app).post("/api/v1/auth/logout").set("Cookie", cookieHeader(token));

      expect(res.status).toBe(204);
      expect(res.text).toBe("");

      const cleared = sessionSetCookie(res) as string;
      expect(cleared).toMatch(/^session=;/);
      expect(cleared).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
      expect(cleared).toContain("HttpOnly");
      expect(cleared).toContain("SameSite=Lax");
      expect(cleared).toContain("Path=/");
    });

    it("ends the session for a browser that honours the cleared cookie", async () => {
      const agent = request.agent(app);
      await agent.post("/api/v1/auth/login").send({ email: ALICE.email, password: DEMO_PASSWORD });
      expect((await agent.get("/api/v1/auth/me")).status).toBe(200);

      await agent.post("/api/v1/auth/logout");

      expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
    });

    it("returns 204 even without a session", async () => {
      const res = await request(app).post("/api/v1/auth/logout");

      expect(res.status).toBe(204);
    });
  });

  describe("password hash exposure", () => {
    it("never appears in any authentication response", async () => {
      const loginRes = await login(app, ALICE.email);
      const responses = [
        loginRes,
        await me(app, sessionToken(loginRes)),
        await login(app, ALICE.email, "wrong-password"),
        await request(app).post("/api/v1/auth/login").send({ email: ALICE.email }),
      ];

      for (const res of responses) {
        const raw = JSON.stringify(res.body) + JSON.stringify(res.headers);
        expect(raw).not.toMatch(/password_?hash/i);
        expect(raw).not.toContain("$2b$");
      }
    });
  });

  describe("login rate limiting", () => {
    async function failLogin(email: string, times: number) {
      for (let attempt = 0; attempt < times; attempt += 1) {
        const res = await login(app, email, "wrong-password");
        expect(res.status).toBe(401);
      }
    }

    it("blocks further attempts on an account after too many failures", async () => {
      await failLogin(ALICE.email, LOGIN_MAX_FAILED_ATTEMPTS);

      const res = await login(app, ALICE.email, "wrong-password");

      expect(res.status).toBe(429);
      expect(res.body.error).toEqual({
        code: "RATE_LIMITED",
        message: "Too many attempts. Please try again later.",
        details: { retryAfterSeconds: expect.any(Number) },
        requestId: expect.any(String),
      });
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
      expect(res.body.error.details.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
      expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    });

    it("blocks even the correct password while the limit is in force", async () => {
      await failLogin(ALICE.email, LOGIN_MAX_FAILED_ATTEMPTS);

      const res = await login(app, ALICE.email);

      expect(res.status).toBe(429);
      expect(setCookies(res)).toEqual([]);
    });

    it("limits each account separately: other customers are unaffected", async () => {
      await failLogin(ALICE.email, LOGIN_MAX_FAILED_ATTEMPTS);
      expect((await login(app, ALICE.email)).status).toBe(429);

      // Same client, same source address, different account.
      expect((await login(app, BOB.email)).status).toBe(200);
    });

    it("counts attempts on the same account regardless of email casing", async () => {
      await failLogin(ALICE.email, LOGIN_MAX_FAILED_ATTEMPTS - 1);
      await failLogin(ALICE.email.toUpperCase(), 1);

      expect((await login(app, ALICE.email)).status).toBe(429);
    });

    it("applies the same limit to unknown emails, so it reveals nothing", async () => {
      await failLogin("nobody@example.com", LOGIN_MAX_FAILED_ATTEMPTS);

      expect((await login(app, "nobody@example.com")).status).toBe(429);
    });

    it("does not count successful logins", async () => {
      for (let attempt = 0; attempt < LOGIN_MAX_FAILED_ATTEMPTS + 2; attempt += 1) {
        expect((await login(app, ALICE.email)).status).toBe(200);
      }
    });

    it("does not count requests rejected by validation", async () => {
      for (let attempt = 0; attempt < LOGIN_MAX_FAILED_ATTEMPTS + 2; attempt += 1) {
        const res = await request(app).post("/api/v1/auth/login").send({ email: ALICE.email });
        expect(res.status).toBe(400);
      }

      expect((await login(app, ALICE.email)).status).toBe(200);
    });
  });
});
