import "server-only";

import { createMcpClient, type McpClient } from "@smithers/mcp-client";

import { loadConfig } from "./config";

let cached: McpClient | null = null;

/**
 * Lazily-built MCP client, configured from the loaded Smithers config.
 *
 * Each MCP gates independently:
 * - mcps.context_a8c.enabled → ContextA8C real (Linear/GitHub/Slack
 *   fan-out + Linear inbox pings)
 * - mcps.fathom.enabled → Fathom real (call recordings via mcp-remote)
 * - mcps.hive_mind.enabled → Hive Mind real (not yet implemented;
 *   currently always mock regardless of flag)
 *
 * Defaults to mock for any source whose flag is off, so a fresh
 * clone with no MCPs configured Just Works.
 */
export async function getMcpClient(): Promise<McpClient> {
  if (cached) return cached;
  const cfg = await loadConfig();
  cached = createMcpClient({
    mockContextA8C: !cfg.mcps.context_a8c.enabled,
    mockFathom: !cfg.mcps.fathom.enabled,
    mockHiveMind: !cfg.mcps.hive_mind.enabled,
    mockLinear: !process.env["LINEAR_API_KEY"],
    internalEmailDomains: cfg.identity.internal_email_domains,
  });
  return cached;
}
