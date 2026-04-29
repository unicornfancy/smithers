// Hive Mind client factory.

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { MockHiveMindTransport } from "./mock";
import type { HiveMindClient } from "./types";

export function createHiveMindClient(
  opts: ResolvedMcpClientOptions,
  cache: SwrCache,
  health: HealthRegistry,
): HiveMindClient {
  // Real Hive Mind MCP isn't published yet; fall back to mock regardless
  // of the flag so the workbench Partner panel renders without a hard
  // crash. Real wiring lands when the team's MCP server ships.
  return new MockHiveMindTransport(opts, cache, health);
}

export type { HiveMindClient } from "./types";
export type {
  KnowledgeSearchHit,
  KnowledgeSearchQuery,
  PartnerLookupQuery,
} from "./types";
