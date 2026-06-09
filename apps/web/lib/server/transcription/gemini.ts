import "server-only";

import type {
  RecordingsQuery,
  TranscriptionAdapter,
  TranscriptionRecording,
  TranscriptionResult,
} from "@smithers/transcription";

/**
 * Stub adapter for Google Meet + Gemini transcripts. The intended
 * implementation searches Google Drive for transcript docs created
 * after `since` (Google Meet's Gemini Assist writes them to a
 * "Meet Recordings" / "Meet Transcripts" folder as Google Docs) and
 * parses attendees + transcript text from the Doc body.
 *
 * Not implemented yet because:
 *   - Drive OAuth is heavier than Granola's bearer-token model, and we
 *     haven't decided whether to lean on the per-session claude.ai
 *     Drive MCP tool or run our own OAuth flow.
 *   - We want to ship Granola first to validate the dispatcher pattern
 *     on a real second provider before layering Drive complexity on
 *     top.
 *
 * The dispatcher returns this stub when config.transcription.provider
 * is "gemini" so the surface fails cleanly and the user sees a setup
 * message rather than a crash.
 */
export class GeminiAdapter implements TranscriptionAdapter {
  readonly provider = "gemini" as const;

  async listRecordings(
    _query: RecordingsQuery,
  ): Promise<TranscriptionResult<TranscriptionRecording[]>> {
    return {
      ok: false,
      error: {
        kind: "not-configured",
        message:
          "Gemini transcription adapter is not implemented yet. Switch transcription.provider to 'fathom' or 'granola' in config.local.yaml.",
      },
    };
  }

  async fetchTranscript(_input: {
    recording_id: string;
    url?: string;
  }): Promise<string | null> {
    return null;
  }

  async isHealthy(): Promise<{ ok: boolean; detail?: string }> {
    return {
      ok: false,
      detail: "Gemini adapter not implemented yet.",
    };
  }
}
