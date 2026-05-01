// Public types for the Fathom client.

import type { CallRecordingRef, SourceResult } from "../types";

export interface RecordingsQuery {
  /** Cap on results returned. Defaults to 20. */
  limit?: number;
  /** ISO date; only recordings at-or-after this point. */
  since?: string;
}

export interface FathomClient {
  listRecordings(
    query: RecordingsQuery,
  ): Promise<SourceResult<CallRecordingRef[]>>;

  /**
   * Fetch the full transcript for a given recording. Returns plain
   * text — Fathom emits speaker turns + timestamps as bulleted text,
   * which is exactly what an analyzing LLM wants. Null on failure
   * (auth missing, recording not found, network error).
   */
  fetchTranscript(input: {
    recording_id: string;
    /** Optional canonical URL — improves resolution when recording_id is ambiguous. */
    url?: string;
  }): Promise<string | null>;
}
