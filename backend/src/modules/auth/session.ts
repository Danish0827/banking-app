import type { CookieOptions, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { env } from "../../config/env.js";
import type { AuthContext } from "./auth.types.js";

export const SESSION_COOKIE_NAME = "session";

const ALGORITHM = "HS256";
const ISSUER = "banking-app";
const secretKey = new TextEncoder().encode(env.SESSION_SECRET);
const subjectSchema = z.uuid();

/**
 * Issues a signed session token (JWT) identifying the customer. The token
 * holds only the customer id and its validity window; nothing sensitive.
 */
export function createSessionToken(
  customerId: string,
  ttlSeconds: number = env.SESSION_TTL_SECONDS,
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);

  return new SignJWT()
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setSubject(customerId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(secretKey);
}

/**
 * Returns the identity carried by a session token, or `null` if the token is
 * missing, malformed, tampered with, signed with another key or expired.
 */
export async function verifySessionToken(token: unknown): Promise<AuthContext | null> {
  if (typeof token !== "string" || token === "") return null;

  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      requiredClaims: ["sub", "exp"],
    });

    const subject = subjectSchema.safeParse(payload.sub);
    return subject.success ? { customerId: subject.data } : null;
  } catch {
    return null;
  }
}

function cookieOptions(): CookieOptions {
  return {
    // Not readable from JavaScript, so an XSS bug cannot steal the session.
    httpOnly: true,
    // Not sent on cross-site POSTs, which blocks CSRF against state-changing routes.
    sameSite: "lax",
    // HTTPS only in production; local development runs over plain HTTP.
    secure: env.NODE_ENV === "production",
    path: "/",
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    ...cookieOptions(),
    maxAge: env.SESSION_TTL_SECONDS * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions());
}
