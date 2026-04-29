// Client-wide options. Real MCP transport config will land alongside the
// `@modelcontextprotocol/sdk` integration; for now we ship mock transports
// that work without any external setup.

import type { SwrTtl } from "./cache";

export interface McpClientOptions {
  /**
   * When true (default), every transport runs in mock mode and returns
   * deterministic seed data. When false, the client attempts to use real MCP
   * transports — currently a NotImplementedError until the SDK is wired up.
   */
  mock?: boolean;
  /**
   * Email domains treated as internal — used to classify activity actors.
   * Defaults to ["automattic.com"].
   */
  internalEmailDomains?: string[];
  /** Default TTLs per call category. Each method may override. */
  ttl?: Partial<DefaultTtls>;
}

export interface DefaultTtls {
  /** Live activity feeds (Slack/GitHub/Linear/Zendesk/P2). */
  activity: SwrTtl;
  /** Inbound pings awaiting reply. */
  pings: SwrTtl;
  /** Hive Mind partner profile. */
  partnerProfile: SwrTtl;
  /** Fathom recording lists. */
  recordings: SwrTtl;
}

export interface ResolvedMcpClientOptions {
  mock: boolean;
  internalEmailDomains: string[];
  ttl: DefaultTtls;
}

const DEFAULT_TTLS: DefaultTtls = {
  activity: { freshMs: 60_000, staleMs: 10 * 60_000 },
  pings: { freshMs: 30_000, staleMs: 5 * 60_000 },
  partnerProfile: { freshMs: 5 * 60_000, staleMs: 60 * 60_000 },
  recordings: { freshMs: 2 * 60_000, staleMs: 30 * 60_000 },
};

export function resolveMcpClientOptions(
  opts: McpClientOptions = {},
): ResolvedMcpClientOptions {
  return {
    mock: opts.mock ?? true,
    internalEmailDomains:
      opts.internalEmailDomains?.length
        ? opts.internalEmailDomains
        : ["automattic.com"],
    ttl: {
      activity: { ...DEFAULT_TTLS.activity, ...(opts.ttl?.activity ?? {}) },
      pings: { ...DEFAULT_TTLS.pings, ...(opts.ttl?.pings ?? {}) },
      partnerProfile: {
        ...DEFAULT_TTLS.partnerProfile,
        ...(opts.ttl?.partnerProfile ?? {}),
      },
      recordings: {
        ...DEFAULT_TTLS.recordings,
        ...(opts.ttl?.recordings ?? {}),
      },
    },
  };
}
