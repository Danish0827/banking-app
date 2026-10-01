import type { RequestHandler } from "express";
import helmet from "helmet";

/**
 * Security headers for a JSON-only API.
 *
 * Helmet's defaults are written for HTML pages. This API never serves HTML,
 * so the policy is as strict as it can be: no content may load, the response
 * may not be framed anywhere, no referrer is sent, and browser features such
 * as camera or payment are disabled. HSTS is sent only in production, where
 * the API is served over HTTPS; in development it would be ignored over HTTP
 * at best, and could pin localhost to HTTPS at worst.
 *
 * The web app's own pages get their headers from next.config.ts.
 */
export function securityHeaders({ production }: { production: boolean }): RequestHandler[] {
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      xFrameOptions: { action: "deny" },
      referrerPolicy: { policy: "no-referrer" },
      strictTransportSecurity: production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
    (_req, res, next) => {
      res.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      );
      next();
    },
  ];
}
