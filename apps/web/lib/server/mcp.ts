import "server-only";

import { createMcpClient, type McpClient } from "@smithers/mcp-client";

import { loadConfig } from "./config";

let cached: McpClient | null = null;

/**
 * Lazily-built MCP client, configured from the loaded Smithers config.
 *
 * `mock: false` switches ContextA8C to the real stdio transport that
 * spawns `npx -y @automattic/mcp-context-a8c`. Hive Mind and Fathom
 * always run in mock mode for now — their real transports land in
 * future slices. The single client interface stays consistent.
 *
 * The gate is `mcps.context_a8c.enabled` from config — a fresh clone
 * with the example config has it on by default; users without
 * Automattic access flip it off and get mock data instead.
 */
export async function getMcpClient(): Promise<McpClient> {
  if (cached) return cached;
  const cfg = await loadConfig();
  cached = createMcpClient({
    mock: !cfg.mcps.context_a8c.enabled,
    internalEmailDomains: cfg.identity.internal_email_domains,
  });
  return cached;
}
