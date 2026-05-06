/**
 * Real Fathom transport — talks to Fathom's hosted MCP via mcp-remote.
 *
 * Fathom's `list_meetings` tool returns plain-text bulleted markdown
 * rather than structured JSON, so the bulk of this file is the line
 * parser that converts those bullets into CallRecordingRef.
 *
 * The user authenticates Fathom OAuth once via `mcp-remote`'s
 * browser-popup flow; the cached tokens at ~/.mcp-auth let our
 * subprocess reuse the session without prompting again.
 */

import type { ResolvedMcpClientOptions } from "../config";
import type { SwrCache } from "../cache";
import type { HealthRegistry } from "../health";
import { runIsolated } from "../isolation";
import { StdioMcpClient } from "../stdio-mcp";
import type { CallRecordingRef, SourceResult } from "../types";
import type { FathomClient, RecordingsQuery } from "./types";

const RECORDINGS_TTL = { freshMs: 5 * 60 * 1000 } as const;

export class RealFathomTransport implements FathomClient {
  private readonly mcp: StdioMcpClient;

  constructor(
    private readonly opts: ResolvedMcpClientOptions,
    private readonly cache: SwrCache,
    private readonly health: HealthRegistry,
  ) {
    this.mcp = new StdioMcpClient({
      label: "fathom",
      command: "npx",
      args: ["-y", "mcp-remote", "https://api.fathom.ai/mcp"],
    });
  }

  async listRecordings(
    query: RecordingsQuery,
  ): Promise<SourceResult<CallRecordingRef[]>> {
    const since = query.since ?? defaultSince();
    const cacheKey = `real:fathom:recordings:${query.limit ?? 20}:${since}`;
    return runIsolated(
      { cache: this.cache, health: this.health },
      {
        source: "fathom",
        cacheKey,
        ttl: RECORDINGS_TTL,
        fetcher: async () => {
          const limit = query.limit ?? 20;
          const text = await this.callListMeetings(since);
          if (!text) return [];
          const recordings = parseFathomListMeetings(text);
          return recordings.slice(0, limit);
        },
      },
    );
  }

  async fetchTranscript(input: {
    recording_id: string;
    url?: string;
  }): Promise<string | null> {
    if (!input.recording_id) return null;
    // Fathom's tool expects recording_id as a number; we string-ify
    // it everywhere else (it threads through URLs cleanly that way),
    // so coerce here. If the id isn't pure-digit (some share-link
    // tokens aren't), fall back to passing the URL only.
    const isNumeric = /^\d+$/.test(input.recording_id);
    const args: Record<string, unknown> = {};
    if (isNumeric) {
      args["recording_id"] = Number(input.recording_id);
    }
    if (input.url) {
      args["url"] = input.url;
    }
    if (Object.keys(args).length === 0) return null;
    try {
      const client = await this.mcp.getClient();
      const result = await client.callTool({
        name: "get_meeting_transcript",
        arguments: args,
      });
      const content = (result.content ?? []) as Array<{
        type: string;
        text?: string;
      }>;
      const text = content.find((c) => c.type === "text")?.text;
      return typeof text === "string" && text.trim().length > 0 ? text : null;
    } catch {
      return null;
    }
  }

  /**
   * Direct text call into list_meetings. Fathom returns plain-text
   * markdown for this tool, so we bypass callJsonTool (which would
   * return null) and pull the raw text.
   */
  private async callListMeetings(since: string): Promise<string | null> {
    const client = await this.mcp.getClient();
    const result = await client.callTool({
      name: "list_meetings",
      arguments: {
        max_pages: 1,
        created_after: since,
        include_summary: false,
      },
    });
    const content = (result.content ?? []) as Array<{
      type: string;
      text?: string;
    }>;
    const text = content.find((c) => c.type === "text")?.text;
    return typeof text === "string" ? text : null;
  }
}

/**
 * 30 days back. Smithers's call-notes panel only shows recent calls
 * per project; pulling further back would just inflate the response.
 */
function defaultSince(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Parse Fathom's `list_meetings` text output:
 *
 *   Found N meeting(s). Each entry has recording_id and url. ...
 *
 *   - Title | YYYY-MM-DD | id: 12345 | url: https://fathom.video/calls/X | recorded by Name | attendees
 *   - ...
 *
 * Each bullet line is one recording. Fields are pipe-separated. We
 * split on " | ", then key off the prefix on each segment ("id:",
 * "url:", "recorded by"). Anything we don't recognize gets folded
 * into the attendees string for downstream display.
 */
export function parseFathomListMeetings(text: string): CallRecordingRef[] {
  const out: CallRecordingRef[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) continue;
    const segments = line
      .slice(2)
      .split(" | ")
      .map((s) => s.trim());
    if (segments.length < 4) continue;

    const title = segments[0]!;
    const dateStr = segments[1]!;
    let recordingId: string | undefined;
    let url: string | undefined;
    const trailing: string[] = [];
    for (let i = 2; i < segments.length; i++) {
      const seg = segments[i]!;
      if (seg.startsWith("id:")) {
        recordingId = seg.slice(3).trim();
      } else if (seg.startsWith("url:")) {
        url = seg.slice(4).trim();
      } else if (seg.startsWith("recorded by")) {
        // Skip — covered by recorded_at + the user's own meetings.
      } else {
        // Anything else is the attendees string Fathom appends after the
        // recorded-by field. Preserve verbatim so partner-domain matching
        // can spot e.g. "grant@thepocketnyc.com" in calendar-link meetings.
        trailing.push(seg);
      }
    }
    if (!recordingId) continue;
    const recordedAt = parseFathomDate(dateStr);
    if (!recordedAt) continue;

    const attendees = trailing.join(", ").trim();
    out.push({
      recording_id: recordingId,
      recorded_at: recordedAt,
      duration_seconds: 0, // list_meetings doesn't expose duration; fetch on demand later.
      title,
      source_url: url,
      attendees: attendees || undefined,
      is_mock: false,
    });
  }
  return out;
}

/** Fathom's date-only strings (YYYY-MM-DD) → ISO timestamp at local noon. */
function parseFathomDate(dateStr: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return undefined;
  // Fathom doesn't include time in list_meetings; anchor at noon to
  // avoid timezone-edge issues that put a 2026-04-30 recording into
  // 2026-04-29 once UTC-converted.
  return new Date(`${dateStr}T12:00:00`).toISOString();
}
