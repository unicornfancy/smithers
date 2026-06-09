# Transcription adapters

Smithers reads call recordings + transcripts through a per-provider adapter pattern. The interface lives in `@smithers/transcription`; concrete adapters live in `apps/web/lib/server/transcription/<name>.ts`; the dispatcher in `apps/web/lib/server/transcription.ts` picks one based on `config.transcription.provider`. UI surfaces (`/calls`, `/today` Recent Calls, project workbench Recent Calls, Process Call) call the dispatched adapter — they don't know which provider is in use.

## Interface

```ts
// packages/transcription/src/index.ts

export interface TranscriptionRecording {
  recording_id: string;
  recorded_at: string;        // ISO timestamp
  duration_seconds: number;
  title?: string;
  source_url?: string;
  attendees?: string;         // raw provider-emitted string
  is_mock?: boolean;
}

export interface TranscriptionAdapter {
  readonly provider: TranscriptionProvider;

  /** Lightweight metadata list — feeds /calls and Recent Calls cards. */
  listRecordings(
    query: RecordingsQuery,
  ): Promise<TranscriptionResult<TranscriptionRecording[]>>;

  /** Full transcript text. Called when Process Call runs, not on listing. */
  fetchTranscript(input: {
    recording_id: string;
    url?: string;
  }): Promise<string | null>;

  /** Cheap readiness check used by /settings → "Test current provider." */
  isHealthy(): Promise<{ ok: boolean; detail?: string }>;
}
```

`TranscriptionResult<T>` is structurally compatible with the `SourceResult<T>` shape used elsewhere in mcp-client — `{ ok: true, data, from, fetched_at }` on success and `{ ok: false, error: { kind, message }, cachedData? }` on failure, where `kind` distinguishes auth/network/not-configured/rate-limited/invalid for surfaces that want to render different states.

## Status

| Adapter | Status | Notes |
|---|---|---|
| `fathom` | shipped (v1) | Default. Wraps the existing Fathom MCP client via `FathomAdapter`, so caching + health tracking + mock mode keep working. |
| `granola` | shipped (v1) | Calls Granola's public API (`https://api.granola.ai/v2`). Auth via `GRANOLA_API_KEY` in `apps/web/.env.local`. |
| `manual` | shipped (v1) | No upstream — `listRecordings` returns `[]` and `fetchTranscript` returns `null`. The Process Call dialog already has a paste-area fallback, so the page renders cleanly with this provider active. |
| `gemini` | stub | Surfaces a clear `not-configured` error on every call. See "Picking up Gemini next" below. |
| `whisper` | stub | Same shape as Gemini — reserved for a future local-audio transcription path. |

## Picking up Gemini next

The intended Gemini implementation surfaces Google Meet + Gemini Assist transcripts, which land as Google Docs in Drive under "Meet Recordings" / "Meet Transcripts." Two open decisions before implementation:

- **Auth.** Two options: lean on the per-session `claude.ai_Google_Drive_*` MCP tools (works in the IDE only; not viable for a TAM running Smithers locally), or run our own Google OAuth flow. The latter is the right answer for a real ship.
- **Mapping.** Doc structure varies — sometimes attendees are in the first paragraph, sometimes embedded as Doc metadata. We'd want at least one example Doc to lock the parser.

When implementing, replace the body of `apps/web/lib/server/transcription/gemini.ts` and the dispatcher case automatically picks it up. Nothing else in the app needs to change.

## Settings + setup wiring

- **`/setup → API keys`** has a `GRANOLA_API_KEY` row alongside Anthropic + Linear.
- **`/settings → Workflow → Transcription provider`** picks which adapter is active. Stub providers are visibly tagged so users don't pick one expecting it to work.
- **`/api/transcription/health`** runs the active adapter's `isHealthy()` — used by the "Test current provider" button on the settings card.
- **Background job** `fathom_sync` was renamed in copy only — the job key + cron path stay so existing crontabs / launchd plists keep firing. Worth a future rename to `transcription_sync` once the dust settles.

## Migration notes (for the historical record)

Until 2026-06-09 the UI surfaces called `mcp.fathom.*` directly. The migration was mostly a search-and-replace:

- 9 callsites swapped `mcp.fathom.listRecordings` / `mcp.fathom.fetchTranscript` for `(await getTranscriptionAdapter()).listRecordings(...)` / `.fetchTranscript(...)`.
- `FathomAdapter` wraps the existing `mcp.fathom` client; the MCP transport stays unchanged.
- The `transcription.provider` config field defaulted to `"manual"` before — flipped to `"fathom"` so existing users see no change after upgrade.
