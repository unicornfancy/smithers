import "server-only";

import type {
  RecordingsQuery,
  TranscriptionAdapter,
  TranscriptionRecording,
  TranscriptionResult,
} from "@smithers/transcription";

/**
 * Granola adapter — talks to Granola's public API. Auth is via the API
 * key stored under the configured env var (default `GRANOLA_API_KEY`).
 *
 * API quick reference (v2 as of writing):
 *
 *   GET  https://api.granola.ai/v2/notes
 *        ?limit=20
 *        &created_after=<iso8601>
 *   GET  https://api.granola.ai/v2/notes/{note_id}
 *
 * The note object carries:
 *   - id (string), title, created_at (iso), duration (seconds),
 *   - attendees: [{ name, email }]
 *   - transcript: { content: <plaintext> }
 *   - summary, action_items — Smithers ignores these; we run our own
 *     extraction agents on the raw transcript so the analysis pipeline
 *     is consistent across providers.
 *
 * If the upstream API shape ever changes we'd update mapGranolaNote /
 * fetchTranscript here; nothing else in Smithers needs to know.
 */
export class GranolaAdapter implements TranscriptionAdapter {
  readonly provider = "granola" as const;

  constructor(private readonly opts: { apiKey: string; baseUrl?: string }) {}

  private get baseUrl(): string {
    return this.opts.baseUrl ?? "https://api.granola.ai/v2";
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.opts.apiKey}`,
      Accept: "application/json",
    };
  }

  async listRecordings(
    query: RecordingsQuery,
  ): Promise<TranscriptionResult<TranscriptionRecording[]>> {
    const params = new URLSearchParams();
    params.set("limit", String(query.limit ?? 20));
    if (query.since) params.set("created_after", query.since);
    const url = `${this.baseUrl}/notes?${params.toString()}`;
    try {
      const res = await fetch(url, { headers: this.headers() });
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: {
            kind: "auth",
            message: "Granola API rejected the credentials. Check GRANOLA_API_KEY.",
          },
        };
      }
      if (res.status === 429) {
        return {
          ok: false,
          error: { kind: "rate-limited", message: "Granola API rate-limited." },
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          error: { kind: "network", message: `Granola API ${res.status}` },
        };
      }
      const body = (await res.json()) as { notes?: GranolaNote[] };
      const data = (body.notes ?? []).map(mapGranolaNote);
      return { ok: true, data, from: "fresh", fetched_at: new Date().toISOString() };
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: "network",
          message: err instanceof Error ? err.message : "Granola fetch failed",
        },
      };
    }
  }

  async fetchTranscript(input: {
    recording_id: string;
    url?: string;
  }): Promise<string | null> {
    const url = `${this.baseUrl}/notes/${encodeURIComponent(input.recording_id)}`;
    try {
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) return null;
      const body = (await res.json()) as { note?: GranolaNote };
      // Granola returns the transcript inline on a single-note fetch.
      const text = body.note?.transcript?.content;
      return text && text.trim() ? text : null;
    } catch {
      return null;
    }
  }

  async isHealthy(): Promise<{ ok: boolean; detail?: string }> {
    const r = await this.listRecordings({ limit: 1 });
    if (r.ok) return { ok: true };
    return { ok: false, detail: r.error.message };
  }
}

interface GranolaNote {
  id: string;
  title?: string;
  created_at?: string;
  duration?: number;
  attendees?: Array<{ name?: string; email?: string }>;
  transcript?: { content?: string };
  url?: string;
}

function mapGranolaNote(note: GranolaNote): TranscriptionRecording {
  const attendees = (note.attendees ?? [])
    .map((a) =>
      a.email ? `${a.name ?? a.email} <${a.email}>` : (a.name ?? ""),
    )
    .filter(Boolean)
    .join(", ");
  return {
    recording_id: note.id,
    recorded_at: note.created_at ?? "",
    duration_seconds: note.duration ?? 0,
    title: note.title,
    source_url: note.url,
    attendees: attendees || undefined,
  };
}
