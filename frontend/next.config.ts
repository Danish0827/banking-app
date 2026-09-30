import type { NextConfig } from "next";

const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // The repository root has its own lockfile (for Prettier); pin the workspace
  // root so Next.js doesn't have to infer it.
  turbopack: { root: __dirname },

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
