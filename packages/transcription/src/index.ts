// @smithers/transcription — pluggable adapter pattern for transcription
// providers (Fathom, Granola, Gemini, manual). The interface mirrors the
// Fathom MCP client's existing shape so the migration cost is mostly the
// dispatcher + per-provider adapters; UI surfaces don't have to change.
//
// Adapter implementations live in apps/web/lib/server/transcription/<name>.ts
// because they call out to provider HTTP APIs (server-only). The package
// here owns the interface + shared types so cross-package consumers can
// type-check against the contract.

export const TRANSCRIPTION_PACKAGE_VERSION = "0.0.2";

export type TranscriptionProvider =
  | "fathom"
  | "granola"
  | "gemini"
  | "manual"
  | "whisper";

export interface RecordingsQuery {
  /** Cap on results returned. Defaults to 20. */
  limit?: number;
  /** ISO date; only recordings at-or-after this point. */
  since?: string;
}

/**
 * Mirrors `CallRecordingRef` in @smithers/mcp-client so the two are
 * interchangeable. Kept duplicated here intentionally — the transcription
 * package shouldn't depend on mcp-client (it's the more foundational
 * layer; adapters wrap external APIs).
 */
export interface TranscriptionRecording {
  recording_id: string;
  recorded_at: string;
  duration_seconds: number;
  title?: string;
  source_url?: string;
  /** Raw attendees string (provider-emitted, comma-separated names/emails). */
  attendees?: string;
  is_mock?: boolean;
}

export type TranscriptionResult<T> =
  | { ok: true; data: T; from?: "fresh" | "cache" | "stale"; fetched_at?: string }
  | {
      ok: false;
      error: { kind: "not-configured" | "auth" | "network" | "invalid" | "rate-limited"; message: string };
      cachedData?: T;
    };

/**
 * The runtime interface every adapter implements. Identical shape to
 * `FathomClient` so the existing 9 callsites in apps/web migrate by
 * swapping `mcp.fathom` for `await getTranscriptionAdapter()`.
 */
export interface TranscriptionAdapter {
  /** Provider identifier — shown in /settings + telemetry. */
  readonly provider: TranscriptionProvider;

  listRecordings(
    query: RecordingsQuery,
  ): Promise<TranscriptionResult<TranscriptionRecording[]>>;

  /**
   * Fetch full transcript text for a given recording. Returns null on any
   * fetch failure so callers can degrade — the typical UX is to show a
   * "transcript not available yet" toast and let the user retry.
   */
  fetchTranscript(input: {
    recording_id: string;
    /** Optional provider URL — improves resolution when recording_id alone is ambiguous. */
    url?: string;
  }): Promise<string | null>;

  /**
   * Quick health check consulted by /settings → Diagnostics and the
   * Fathom-sync background job (now a generic transcription-sync once
   * adapters are wired). Returns `{ ok: false, detail }` when the
   * provider is unreachable or unauthorized.
   */
  isHealthy(): Promise<{ ok: boolean; detail?: string }>;
}
