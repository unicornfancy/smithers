// Hive Mind client factory.

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { McpClientError } from "../isolation";
import { MockHiveMindTransport } from "./mock";
import type { HiveMindClient } from "./types";

export function createHiveMindClient(
  opts: ResolvedMcpClientOptions,
  cache: SwrCache,
  health: HealthRegistry,
): HiveMindClient {
  if (opts.mock) {
    return new MockHiveMindTransport(opts, cache, health);
  }
  throw new McpClientError(
    "not-implemented",
    "Real Hive Mind transport is not yet wired. Set `mock: true` until the @modelcontextprotocol/sdk integration lands.",
  );
}

export type { HiveMindClient } from "./types";
export type {
  KnowledgeSearchHit,
  KnowledgeSearchQuery,
  PartnerLookupQuery,
} from "./types";
