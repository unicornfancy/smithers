import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  experimental: {
    // Launch-post images (screenshots) routinely exceed the 1MB default.
    // Smithers runs locally — there's no proxy upload limit to worry about.
    serverActions: { bodySizeLimit: "25mb" },
  },
  transpilePackages: [
    "@smithers/vault",
    "@smithers/mcp-client",
    "@smithers/agents",
    "@smithers/transcription",
    "@smithers/ui",
  ],
  // The @modelcontextprotocol/sdk uses node-only APIs (node:crypto,
  // child_process). googleapis pulls in `gaxios` + `gtoken` which also
  // depend on node:crypto / streams. Marking both external keeps them
  // as server-only requires even when @smithers/mcp-client (which
  // depends on both) is being transpiled.
  serverExternalPackages: ["@modelcontextprotocol/sdk", "googleapis"],
};

export default nextConfig;
