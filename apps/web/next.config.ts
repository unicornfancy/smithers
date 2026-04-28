import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  transpilePackages: [
    "@smithers/vault",
    "@smithers/mcp-client",
    "@smithers/agents",
    "@smithers/transcription",
    "@smithers/ui",
  ],
};

export default nextConfig;
