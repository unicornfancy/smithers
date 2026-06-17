import "server-only";

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

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

  // Drive needs BOTH the OAuth keys (downloaded from Google Cloud) AND
  // the cached refresh-token credentials (written by the MCP's
  // one-time `auth` command). If either is missing, fall back to the
  // mock so the workbench feed degrades to "no Drive activity" rather
  // than crashing the request.
  const driveOAuthPath = expandHome(cfg.mcps.google_drive.oauth_keys_path);
  const driveCredsPath = expandHome(cfg.mcps.google_drive.creds_path);
  const driveReady =
    cfg.mcps.google_drive.enabled &&
    Boolean(driveOAuthPath) &&
    Boolean(driveCredsPath) &&
    existsSync(driveOAuthPath) &&
    existsSync(driveCredsPath);

  cached = createMcpClient({
    mockContextA8C: !cfg.mcps.context_a8c.enabled,
    mockFathom: !cfg.mcps.fathom.enabled,
    mockHiveMind: !cfg.mcps.hive_mind.enabled || !hiveMindServerReady,
    mockLinear: !process.env["LINEAR_API_KEY"],
    mockGoogleDrive: !driveReady,
    internalEmailDomains: cfg.identity.internal_email_domains,
    selfEmail: cfg.identity.email,
    hiveMindServerPath: hiveMindServerReady ? hiveMindServerPath : undefined,
    googleDriveOAuthPath: driveReady ? driveOAuthPath : undefined,
    googleDriveCredsPath: driveReady ? driveCredsPath : undefined,
  });
  return cached;
}

function expandHome(p: string | undefined): string {
  if (!p) return "";
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}
