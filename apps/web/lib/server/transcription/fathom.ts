import "server-only";

import type { CallRecordingRef, SourceResult } from "@smithers/mcp-client";
import type {
  RecordingsQuery,
  TranscriptionAdapter,
  TranscriptionRecording,
  TranscriptionResult,
} from "@smithers/transcription";

import { getMcpClient } from "@/lib/server/mcp";

/**
 * Adapter wrapper around the existing Fathom MCP client. The MCP client
 * already implements the same shape (listRecordings + fetchTranscript),
 * so this is mostly a pass-through that bridges the SourceResult /
 * CallRecordingRef shapes from @smithers/mcp-client to the
 * TranscriptionAdapter / TranscriptionRecording shapes that downstream
 * adapters (Granola, Gemini) also conform to.
 *
 * Keeping the MCP transport intact means Fathom-side caching + health
 * tracking + mock mode all keep working without any changes — only
 * callsites that used `mcp.fathom.*` directly now go through this.
 */
export class FathomAdapter implements TranscriptionAdapter {
  readonly provider = "fathom" as const;

  async listRecordings(
    query: RecordingsQuery,
  ): Promise<TranscriptionResult<TranscriptionRecording[]>> {
    const mcp = await getMcpClient();
    const result = await mcp.fathom.listRecordings(query);
    return mapSourceResult(result);
  }

  async fetchTranscript(input: {
    recording_id: string;
    url?: string;
  }): Promise<string | null> {
    const mcp = await getMcpClient();
    return mcp.fathom.fetchTranscript(input);
  }

  async isHealthy(): Promise<{ ok: boolean; detail?: string }> {
    // Fathom's MCP client doesn't expose a separate health probe — a
    // limit-1 list is the cheapest readiness check. Treat a successful
    // ok=true result (even with 0 items) as healthy; ok=false maps to
    // unhealthy with the error message.
    const r = await this.listRecordings({ limit: 1 });
    if (r.ok) return { ok: true };
    return { ok: false, detail: r.error.message };
  }
}

function mapSourceResult(
  src: SourceResult<CallRecordingRef[]>,
): TranscriptionResult<TranscriptionRecording[]> {
  if (src.ok) {
    return { ok: true, data: src.data, from: src.from, fetched_at: src.fetched_at };
  }
  return {
    ok: false,
    error: { kind: "network", message: src.error.message },
    cachedData: src.cachedData,
  };
}
