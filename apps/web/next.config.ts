import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@whizchool/shared", "@whizchool/demo"],
  // In development with the real API, forward /api/v1 to Express so the browser sees one origin
  // and the session cookie stays first-party. In production Caddy routes /api before Next.js.
  async rewrites() {
    if (process.env.NEXT_PUBLIC_API_MODE !== "http") return [];
    const target = (process.env.API_PROXY_TARGET ?? "http://localhost:4000").replace(/\/+$/, "");
    return [{ source: "/api/v1/:path*", destination: `${target}/api/v1/:path*` }];
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
