import "server-only";

import type {
  RecordingsQuery,
  TranscriptionAdapter,
  TranscriptionRecording,
  TranscriptionResult,
} from "@smithers/transcription";

/**
 * "Manual" pseudo-provider: the user pastes a transcript by hand. There
 * are no recordings to list (Smithers can't know about calls the user
 * hasn't told it about), and fetchTranscript by id is undefined for the
 * same reason — there's no source to fetch from.
 *
 * Listing returns an empty array (ok=true) so /calls / /today /
 * workbench Recent Calls render cleanly as "no recent recordings."
 * fetchTranscript returns null. The Process Call dialog opens with a
 * paste-area instead of an upstream fetch when this adapter is active
 * (Process Call already has a manual-paste fallback path).
 */
export class ManualAdapter implements TranscriptionAdapter {
  readonly provider = "manual" as const;

  async listRecordings(
    _query: RecordingsQuery,
  ): Promise<TranscriptionResult<TranscriptionRecording[]>> {
    return {
      ok: true,
      data: [],
      from: "fresh",
      fetched_at: new Date().toISOString(),
    };
  }

  async fetchTranscript(_input: {
    recording_id: string;
    url?: string;
  }): Promise<string | null> {
    return null;
  }

  async isHealthy(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: "Manual paste mode — no upstream provider." };
  }
}
