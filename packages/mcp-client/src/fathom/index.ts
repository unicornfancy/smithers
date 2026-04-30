// Fathom client factory.

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { MockFathomTransport } from "./mock";
import { RealFathomTransport } from "./real";
import type { FathomClient } from "./types";

export function createFathomClient(
  opts: ResolvedMcpClientOptions,
  cache: SwrCache,
  health: HealthRegistry,
): FathomClient {
  if (opts.mockFathom) {
    return new MockFathomTransport(opts, cache, health);
  }
  return new RealFathomTransport(opts, cache, health);
}

export type { FathomClient, RecordingsQuery } from "./types";
