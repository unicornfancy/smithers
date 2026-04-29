// ContextA8C client factory.
//
// Today this is mock-only. The real implementation will lean on
// `@modelcontextprotocol/sdk` to talk to the user-installed ContextA8C MCP
// server; the per-source isolation already provided by `runIsolated` keeps
// each sub-source (slack, github, …) independently retried and cached.

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { McpClientError } from "../isolation";
import { MockContextA8CTransport } from "./mock";
import type { ContextA8CClient } from "./types";

export function createContextA8CClient(
  opts: ResolvedMcpClientOptions,
  cache: SwrCache,
  health: HealthRegistry,
): ContextA8CClient {
  if (opts.mock) {
    return new MockContextA8CTransport(opts, cache, health);
  }
  throw new McpClientError(
    "not-implemented",
    "Real ContextA8C transport is not yet wired. Set `mock: true` until the @modelcontextprotocol/sdk integration lands.",
  );
}

export type { ContextA8CClient } from "./types";
export type {
  PingsQuery,
  ProjectActivityQuery,
  ProjectActivityRefs,
  ActivitySourceFilter,
} from "./types";
