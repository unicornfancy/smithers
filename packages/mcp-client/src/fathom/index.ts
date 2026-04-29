// Fathom client factory.

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { MockFathomTransport } from "./mock";
import type { FathomClient } from "./types";

export function createFathomClient(
  opts: ResolvedMcpClientOptions,
  cache: SwrCache,
  health: HealthRegistry,
): FathomClient {
  // Real Fathom MCP wiring is the transcription-adapters slice — not
  // landed yet. Fall back to mock so the call-notes panel renders.
  return new MockFathomTransport(opts, cache, health);
}

export type { FathomClient, RecordingsQuery } from "./types";
