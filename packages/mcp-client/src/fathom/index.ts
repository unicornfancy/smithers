// Fathom client factory.

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { McpClientError } from "../isolation";
import { MockFathomTransport } from "./mock";
import type { FathomClient } from "./types";

export function createFathomClient(
  opts: ResolvedMcpClientOptions,
  cache: SwrCache,
  health: HealthRegistry,
): FathomClient {
  if (opts.mock) {
    return new MockFathomTransport(opts, cache, health);
  }
  throw new McpClientError(
    "not-implemented",
    "Real Fathom transport is not yet wired. Set `mock: true` until the transcription adapters slice lands.",
  );
}

export type { FathomClient, RecordingsQuery } from "./types";
