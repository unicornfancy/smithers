# Transcription adapters

Smithers supports multiple transcription providers via a thin adapter pattern. The vault watcher's "process new call" trigger is provider-agnostic — it asks the configured adapter for new recordings, gets a `CallTranscript`, and runs the same downstream logic (action items extraction; P2 draft generation if any attendee is external).

## Interface

```ts
// packages/transcription/src/types.ts

export interface Attendee {
  name: string;
  email?: string;
  isExternal: boolean;  // computed via config.identity.internal_email_domains
}

export interface CallTranscript {
  recording_id: string;
  recorded_at: string;       // ISO timestamp
  duration_seconds: number;
  title?: string;
  attendees: Attendee[];
  transcript_text: string;   // raw plain-text transcript; no AI summary inside
  source_url?: string;       // back-link to the provider's UI when applicable
}

export interface TranscriptionAdapter {
  /** Provider name (used in /settings UI). */
  readonly name: string;

  /** Fetch any recordings since `since`. */
  listNewRecordings(since: Date): Promise<CallTranscript[]>;

  /** Fetch a single transcript by id (used for backfill / retry). */
  getTranscript(recording_id: string): Promise<CallTranscript>;

  /** Quick health check; consulted by /settings → MCP Health and the briefing job. */
  isHealthy(): Promise<{ ok: boolean; detail?: string }>;
}
```

## Bundled adapters

| Adapter | Status | Notes |
|---|---|---|
| `fathom` | implemented (v1) | Polls Fathom MCP every 10 min by default. Reads attendees from meeting metadata. |
| `granola` | implemented (v1) | Uses the Granola API (`api_key_env: GRANOLA_API_KEY`). Supports macOS local cache fallback. |
| `manual` | implemented (v1) | "Paste a transcript" UI in /today. Useful when no provider was running for a call. |
| `whisper` | stub | Local Whisper transcription from audio files. Implementation deferred. |
| `gemini` | stub | Google Gemini live-transcription. Implementation deferred. |

Stubs throw `NotImplementedError` and are visible in /settings → Transcription so users can plan around them.

## Configuration

In `config.yaml`:

```yaml
transcription:
  provider: fathom            # one of: fathom | granola | manual | whisper | gemini
  fathom:
    api_key_env: "FATHOM_API_KEY"
  granola:
    api_key_env: "GRANOLA_API_KEY"
```

Switching providers is a `/settings` action; Smithers uses the new adapter for new recordings going forward and leaves historical transcripts untouched.

## Adding a new adapter

1. Implement `TranscriptionAdapter` in `packages/transcription/src/adapters/<name>/`.
2. Register it in `packages/transcription/src/registry.ts`.
3. Add a `<name>:` block to `config.example.yaml` with any required env vars.
4. Add a row to the table above and (optionally) a screenshot to docs.

## Why the indirection

The original system was Fathom-only. Different teams use different transcription tools, and audio→text is genuinely commoditized. Making the trigger provider-agnostic means action-item extraction and P2 drafting work identically regardless of where the transcript came from — including a hand-pasted one.
