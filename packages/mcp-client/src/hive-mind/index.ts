// Hive Mind client factory.

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { MockHiveMindTransport } from "./mock";
import { RealHiveMindTransport } from "./real";
import type { HiveMindClient } from "./types";

export function createHiveMindClient(
  opts: ResolvedMcpClientOptions,
  cache: SwrCache,
  health: HealthRegistry,
): HiveMindClient {
  if (!opts.mockHiveMind) {
    return new RealHiveMindTransport(opts, cache, health);
  }
  return new MockHiveMindTransport(opts, cache, health);
}

export type { HiveMindClient } from "./types";
export type {
  HiveMindProjectNotes,
  KnowledgeSearchHit,
  KnowledgeSearchQuery,
  PartnerLookupQuery,
} from "./types";
