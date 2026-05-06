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
  // The @modelcontextprotocol/sdk uses node-only APIs (node:crypto,
  // child_process). Marking it external keeps it as a server-only require
  // even when @smithers/mcp-client (which depends on it) is being
  // transpiled.
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
};

export default nextConfig;
