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

  async fetchTranscript(input: {
    recording_id: string;
    url?: string;
  }): Promise<string | null> {
    if (!input.recording_id) return null;
    // Stable seeded transcript so demo screenshots are reproducible.
    return `Demo transcript for recording ${input.recording_id}.

[00:01] Riley Chen: Thanks for jumping on. Let's start with the timeline question on the new homepage layout.
[00:18] Partner contact: Right — we're targeting end of next week for the live cut. The accordion blocks are the open item.
[00:42] Riley Chen: We can have the accordion done by Wednesday. I'll send a Loom once it's on staging.
[01:10] Partner contact: Great. One more thing — Tom flagged the Gravity Forms migration. Can we line up a 30-min call for that next week?
[01:28] Riley Chen: Yes. I'll propose three slots in email.
[01:55] Partner contact: Perfect. We're done.`;
  }
}
