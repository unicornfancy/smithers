import "server-only";

import { existsSync } from "node:fs";
import { join } from "node:path";

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
 * - mcps.hive_mind.enabled → Hive Mind real, spawning the local
 *   server at `<paths.hive_mind>/mcp/server/dist/index.js`. Falls
 *   back to mock if the dist file is missing (server not built yet).
 *
 * Defaults to mock for any source whose flag is off, so a fresh
 * clone with no MCPs configured Just Works.
 */
export async function getMcpClient(): Promise<McpClient> {
  if (cached) return cached;
  const cfg = await loadConfig();
  const hiveMindServerPath = cfg.paths.hive_mind
    ? join(cfg.paths.hive_mind, "mcp/server/dist/index.js")
    : "";
  const hiveMindServerReady =
    Boolean(hiveMindServerPath) && existsSync(hiveMindServerPath);
  cached = createMcpClient({
    mockContextA8C: !cfg.mcps.context_a8c.enabled,
    mockFathom: !cfg.mcps.fathom.enabled,
    mockHiveMind: !cfg.mcps.hive_mind.enabled || !hiveMindServerReady,
    mockLinear: !process.env["LINEAR_API_KEY"],
    internalEmailDomains: cfg.identity.internal_email_domains,
    hiveMindServerPath: hiveMindServerReady ? hiveMindServerPath : undefined,
  });
  return cached;
}
