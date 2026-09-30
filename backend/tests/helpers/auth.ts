import type { Express } from "express";
import request, { type Response } from "supertest";
import { DEMO_PASSWORD, SEED_CUSTOMERS, type SeedCustomer } from "../../src/db/seed/seedData.js";
import { SESSION_COOKIE_NAME } from "../../src/modules/auth/session.js";

export const ALICE = SEED_CUSTOMERS[0] as SeedCustomer;
export const BOB = SEED_CUSTOMERS[1] as SeedCustomer;

export function login(app: Express, email: string, password: string = DEMO_PASSWORD) {
  return request(app).post("/api/v1/auth/login").send({ email, password });
}

/** All Set-Cookie headers of a response. */
export function setCookies(res: Response): string[] {
  const header = res.headers["set-cookie"] as string[] | string | undefined;
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

/** The full Set-Cookie line for the session cookie, or undefined if none was set. */
export function sessionSetCookie(res: Response): string | undefined {
  return setCookies(res).find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
}

/** The session token issued by a login response. */
export function sessionToken(res: Response): string {
  const cookie = sessionSetCookie(res);
  if (!cookie) throw new Error("Response did not set a session cookie");
  return cookie.slice(SESSION_COOKIE_NAME.length + 1).split(";", 1)[0] as string;
}

/** A Cookie request header carrying the given session token. */
export function cookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}
