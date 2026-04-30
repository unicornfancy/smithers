// ContextA8C client factory.
//
// Two transports live behind this factory:
// - MockContextA8CTransport: deterministic seeded fake data, used in
//   the public template / when no real MCP is configured.
// - RealContextA8CTransport: spawns `npx -y @automattic/mcp-context-a8c`
//   as a long-lived stdio MCP child process and forwards calls to it.
//
// The factory picks based on the resolved options: `mock: true` always
// returns the mock; otherwise we attempt the real one.

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { MockContextA8CTransport } from "./mock";
import { RealContextA8CTransport } from "./real";
import type { ContextA8CClient } from "./types";

export function createContextA8CClient(
  opts: ResolvedMcpClientOptions,
  cache: SwrCache,
  health: HealthRegistry,
): ContextA8CClient {
  if (opts.mockContextA8C) {
    return new MockContextA8CTransport(opts, cache, health);
  }
  return new RealContextA8CTransport(opts, cache, health);
}

export type {
  ContextA8CClient,
  ZendeskSearchResult,
  ZendeskTicketSummary,
} from "./types";
export type {
  PingsQuery,
  ProjectActivityQuery,
  ProjectActivityRefs,
  ActivitySourceFilter,
} from "./types";
