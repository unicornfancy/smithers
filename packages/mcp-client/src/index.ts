// @smithers/mcp-client
//
// Typed wrappers around the three MCPs Smithers cares about:
//   - ContextA8C  → Slack / GitHub / Linear / Zendesk / P2 / wpcom
//   - Hive Mind   → partner profiles + cross-team knowledge search
//   - Fathom      → call recording references
//
// Every public method funnels through `runIsolated`, which provides:
//   1. SWR cache (in-memory; SQLite L2 lands later)
//   2. Retry-with-backoff (Layer A of the six-layer resilience model)
//   3. Per-source isolation + health bookkeeping (Layers B + F)
//
// Today only mock transports are implemented — real MCP wiring lands
// alongside the Anthropic SDK integration. Mock mode is the default so the
// app works on a fresh clone without any external setup.

export const MCP_CLIENT_PACKAGE_VERSION = "0.0.2";

import { SwrCache } from "./cache";
import {
  resolveMcpClientOptions,
  type McpClientOptions,
  type ResolvedMcpClientOptions,
} from "./config";
import { HealthRegistry } from "./health";
import { createContextA8CClient } from "./context-a8c/index";
import { createHiveMindClient } from "./hive-mind/index";
import { createFathomClient } from "./fathom/index";
import { createLinearClient } from "./linear/index";

import type { ContextA8CClient } from "./context-a8c/index";
import type { HiveMindClient } from "./hive-mind/index";
import type { FathomClient } from "./fathom/index";
import type { LinearClient } from "./linear/index";
import type { SourceHealth } from "./types";

export interface McpClient {
  contextA8C: ContextA8CClient;
  hiveMind: HiveMindClient;
  fathom: FathomClient;
  linear: LinearClient;

  /** Snapshot of all known source health, for /settings → MCP Health. */
  health(): SourceHealth[];

  /** True when any source is degraded or down. Drives the header indicator. */
  hasIssues(): boolean;

  /** Resolved configuration the client is running with. */
  config: ResolvedMcpClientOptions;
}

export function createMcpClient(opts: McpClientOptions = {}): McpClient {
  const resolved = resolveMcpClientOptions(opts);
  const cache = new SwrCache();
  const healthRegistry = new HealthRegistry();
  const contextA8C = createContextA8CClient(resolved, cache, healthRegistry);
  const hiveMind = createHiveMindClient(resolved, cache, healthRegistry);
  const fathom = createFathomClient(resolved, cache, healthRegistry);
  const linear = createLinearClient(resolved);

  return {
    contextA8C,
    hiveMind,
    fathom,
    linear,
    config: resolved,
    health: () => healthRegistry.snapshot(),
    hasIssues: () => healthRegistry.hasIssues(),
  };
}

export type { McpClientOptions, ResolvedMcpClientOptions } from "./config";
export type {
  SourceResult,
  SourceHealth,
  McpError,
  McpSourceId,
  ActivityEvent,
  ActivitySource,
  ActivityKind,
  ActivityActor,
  ProjectMatch,
  Ping,
  PartnerProfile,
  PartnerTeamMember,
  CallRecordingRef,
} from "./types";
export type {
  ContextA8CClient,
  LinearProjectMetadata,
  ZendeskSearchResult,
  ZendeskTicketSummary,
} from "./context-a8c/index";
export type {
  ProjectActivityQuery,
  ProjectActivityRefs,
  PingsQuery,
  ActivitySourceFilter,
} from "./context-a8c/index";
export {
  extractTicketId,
  parseTicketRefs,
  zendeskTicketUrl,
  type ParsedTicketRef,
} from "./context-a8c/zendesk-refs";
export type {
  HiveMindClient,
  HiveMindProjectNotes,
  PartnerLookupQuery,
  KnowledgeSearchQuery,
  KnowledgeSearchHit,
} from "./hive-mind/index";
export type { FathomClient, RecordingsQuery } from "./fathom/index";
export type {
  LinearClient,
  LinearProject,
  LinearIssue,
  LinearIssueDetail,
  LinearProjectUpdate,
} from "./linear/index";
export { McpClientError } from "./isolation";
