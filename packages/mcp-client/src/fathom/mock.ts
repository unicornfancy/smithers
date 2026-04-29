// Mock Fathom transport. Returns an empty list — the seed vault doesn't
// include canned call recordings (those live downstream of the transcription
// adapters slice).

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { runIsolated } from "../isolation";
import type { CallRecordingRef, SourceResult } from "../types";
import type { FathomClient, RecordingsQuery } from "./types";

export class MockFathomTransport implements FathomClient {
  constructor(
    private readonly opts: ResolvedMcpClientOptions,
    private readonly cache: SwrCache,
    private readonly health: HealthRegistry,
  ) {}

  async listRecordings(
    query: RecordingsQuery,
  ): Promise<SourceResult<CallRecordingRef[]>> {
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "fathom",
        cacheKey: `mock:fathom:recordings:${query.limit ?? 20}:${query.since ?? "*"}`,
        ttl: this.opts.ttl.recordings,
        fetcher: async () => [],
      },
    );
  }
}
