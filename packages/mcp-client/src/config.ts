// Client-wide options. Real MCP transport config will land alongside the
// `@modelcontextprotocol/sdk` integration; for now we ship mock transports
// that work without any external setup.

import type { SwrTtl } from "./cache";

export interface McpClientOptions {
  /**
   * Default mock-mode flag. Each per-source flag (mockContextA8C,
   * mockFathom, mockHiveMind) inherits this when not set. Defaults to
   * true so a fresh clone with no MCPs configured Just Works.
   */
  mock?: boolean;
  /** Override the default for ContextA8C only. */
  mockContextA8C?: boolean;
  /** Override the default for Fathom only. */
  mockFathom?: boolean;
  /** Override the default for Hive Mind only. */
  mockHiveMind?: boolean;
  /** Override the default for Linear only. */
  mockLinear?: boolean;
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
  /** Legacy flag kept for back-compat — equals mockContextA8C. */
  mock: boolean;
  mockContextA8C: boolean;
  mockFathom: boolean;
  mockHiveMind: boolean;
  mockLinear: boolean;
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
  const defaultMock = opts.mock ?? true;
  const mockContextA8C = opts.mockContextA8C ?? defaultMock;
  const mockFathom = opts.mockFathom ?? defaultMock;
  const mockHiveMind = opts.mockHiveMind ?? defaultMock;
  const mockLinear = opts.mockLinear ?? defaultMock;
  return {
    mock: mockContextA8C,
    mockContextA8C,
    mockFathom,
    mockHiveMind,
    mockLinear,
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
