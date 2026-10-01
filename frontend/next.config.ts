import type { NextConfig } from "next";

const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:4000";
const isDevelopment = process.env.NODE_ENV === "development";

/**
 * Content Security Policy for the web app's pages.
 *
 * Next.js renders inline bootstrap scripts and styles, so 'unsafe-inline' is
 * needed for script-src and style-src without a nonce-based setup (which
 * would require dynamic rendering of every page). The policy still blocks
 * scripts from any other origin, plugins, <base> tag injection, forms posting
 * elsewhere and, most importantly for a banking UI, being framed by any site
 * (clickjacking). Development additionally needs eval and a WebSocket for
 * hot reloading.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDevelopment ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // HTTPS only: a production deployment is expected to terminate TLS.
  ...(isDevelopment
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  // The repository root has its own lockfile (for Prettier); pin the workspace
  // root so Next.js doesn't have to infer it.
  turbopack: { root: __dirname },

  // Don't advertise the framework in an X-Powered-By header.
  poweredByHeader: false,

  // Security headers for every page. /api responses are excluded: they come
  // from the backend, which sets its own stricter headers for JSON.
  async headers() {
    return [{ source: "/((?!api/).*)", headers: securityHeaders }];
  },

  // Proxy API calls through Next.js so the browser only ever talks to one
  // origin: no CORS configuration, and session cookies stay first-party.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
