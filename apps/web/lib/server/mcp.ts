import "server-only";

import { createMcpClient, type McpClient } from "@smithers/mcp-client";

import { loadConfig } from "./config";

let cached: McpClient | null = null;

/**
 * Lazily-built MCP client, configured from the loaded Smithers config.
 *
 * Today, every transport runs in mock mode unless all three MCPs are
 * explicitly enabled — and even then, the real transports are not yet
 * implemented (they throw NotImplementedError). The web app uses the same
 * shape regardless, so swapping in real MCP wiring later is a single-flag
 * change.
 */
export async function getMcpClient(): Promise<McpClient> {
  if (cached) return cached;
  const cfg = await loadConfig();
  const mcpsAllEnabled =
    cfg.mcps.context_a8c.enabled &&
    cfg.mcps.hive_mind.enabled &&
    cfg.mcps.fathom.enabled;
  cached = createMcpClient({
    mock: !mcpsAllEnabled,
    internalEmailDomains: cfg.identity.internal_email_domains,
  });
  return cached;
}
