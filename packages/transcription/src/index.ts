// @smithers/transcription — pluggable adapter pattern for transcription providers.
//
// See docs/TRANSCRIPTION-ADAPTERS.md for the full interface and rationale.
// Implementation lands as part of the `transcription_adapters` todo.

export const TRANSCRIPTION_PACKAGE_VERSION = "0.0.1";

export interface Attendee {
  name: string;
  email?: string;
  isExternal: boolean;
}

export interface CallTranscript {
  recording_id: string;
  recorded_at: string;
  duration_seconds: number;
  title?: string;
  attendees: Attendee[];
  transcript_text: string;
  source_url?: string;
}

export interface TranscriptionAdapter {
  readonly name: string;
  listNewRecordings(since: Date): Promise<CallTranscript[]>;
  getTranscript(recording_id: string): Promise<CallTranscript>;
  isHealthy(): Promise<{ ok: boolean; detail?: string }>;
}
