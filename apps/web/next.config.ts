import type { NextConfig } from "next";

/**
 * Where the orchestrator is. On Render this is the API's private address
 * ("tasker-api-abcd:10000"), which comes without a scheme; locally it is a full URL.
 */
function apiBase(): string {
  const raw = (process.env.API_BASE || "http://localhost:3001").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
}

const nextConfig: NextConfig = {
  // Same-origin proxy to the orchestrator: no CORS, no cross-site cookies,
  // and the browser never needs to know the API's address.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiBase()}/:path*`,
      },
    ];
  },
};

export default nextConfig;
