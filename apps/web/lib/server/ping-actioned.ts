import "server-only";

import type { Ping } from "@smithers/mcp-client";

import { loadConfig } from "./config";
import { getDb } from "./db";
import { getMcpClient } from "./mcp";

/**
 * Lightweight subset of `Ping` needed for actioned-detection — keeps the
 * server-action payload small and avoids serializing the full ping
 * object across the boundary.
 */
export type PingActionedInput = Pick<
  Ping,
  "id" | "source" | "url" | "timestamp"
>;

/**
 * Per-ping "did Katie already reply" verdict storage. The cache is
 * populated by an explicit Refresh action on /today's Pings panel —
 * not on every page load — so the per-source MCP fanout cost is paid
 * on demand only. Reads are SQLite, fast.
 *
 * Sources covered in v1: Zendesk + GitHub. Slack + Linear land in a
 * follow-up (need identity probes). P2 stays unchecked.
 */
export interface PingActionedRow {
  pingId: string;
  actioned: boolean;
  /** ISO timestamp of the last refresh check. */
  checkedAt: string;
}

/**
 * Look up cached actioned-status for a list of ping ids. Pings absent
 * from the cache are simply omitted from the returned map (caller
 * treats missing as "not yet checked").
 */
export async function getActionedStatuses(
  pingIds: string[],
): Promise<Map<string, PingActionedRow>> {
  const out = new Map<string, PingActionedRow>();
  if (pingIds.length === 0) return out;
  const db = await getDb();
  const placeholders = pingIds.map(() => "?").join(",");
  const rows = db
    .prepare<
      string[],
      { ping_id: string; actioned: number; checked_at: string }
    >(
      `SELECT ping_id, actioned, checked_at FROM ping_actioned
       WHERE ping_id IN (${placeholders})`,
    )
    .all(...pingIds);
  for (const row of rows) {
    out.set(row.ping_id, {
      pingId: row.ping_id,
      actioned: row.actioned === 1,
      checkedAt: row.checked_at,
    });
  }
  return out;
}

/** Most-recent `checked_at` across all rows, for the freshness label. */
export async function getMostRecentCheckedAt(): Promise<string | null> {
  const db = await getDb();
  const row = db
    .prepare<[], { checked_at: string }>(
      `SELECT checked_at FROM ping_actioned
       ORDER BY checked_at DESC LIMIT 1`,
    )
    .get();
  return row?.checked_at ? sqliteTimestampToIso(row.checked_at) : null;
}

/**
 * SQLite's `datetime('now')` returns UTC in the format `"YYYY-MM-DD
 * HH:MM:SS"` — no `T` separator, no `Z` suffix. Browsers parse this
 * inconsistently (Safari treats it as local time). Normalize to ISO
 * so the freshness label renders correctly on the client.
 */
function sqliteTimestampToIso(s: string): string {
  if (!s) return s;
  if (/T.*Z$/.test(s)) return s;
  return s.replace(" ", "T") + "Z";
}

async function writeVerdict(
  pingId: string,
  actioned: boolean,
): Promise<void> {
  const db = await getDb();
  db.prepare(
    `INSERT INTO ping_actioned(ping_id, actioned, checked_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(ping_id) DO UPDATE SET
       actioned = excluded.actioned,
       checked_at = excluded.checked_at`,
  ).run(pingId, actioned ? 1 : 0);
}

/**
 * Per-source dispatch: ask the right MCP transport whether the user has
 * replied since the ping's timestamp. Failures collapse to `false` —
 * we'd rather show an unactioned ping the user already replied to than
 * crash the panel.
 */
async function detectActioned(ping: PingActionedInput): Promise<boolean> {
  const cfg = await loadConfig();
  const mcp = await getMcpClient();
  switch (ping.source) {
    case "zendesk": {
      const ticketRef = ping.url ?? extractZendeskRef(ping.id);
      if (!ticketRef) return false;
      return mcp.contextA8C
        .checkZendeskTicketActioned(ticketRef, ping.timestamp)
        .catch(() => false);
    }
    case "github": {
      // Falls back to the same hardcoded handle that listGithubMentionPings
      // uses in /today's page.tsx — keeps the detector working without
      // requiring identity.github_handle to be set in config.local.yaml.
      const login = cfg.identity.github_handle || "unicornfancy";
      if (!ping.url) return false;
      return mcp.contextA8C
        .checkGithubIssueActioned(ping.url, ping.timestamp, login)
        .catch(() => false);
    }
    case "slack": {
      const slackHandle = cfg.identity.slack_handle;
      if (!ping.url || !slackHandle) return false;
      return mcp.contextA8C
        .checkSlackActioned(ping.url, ping.timestamp, slackHandle)
        .catch(() => false);
    }
    case "linear": {
      if (!ping.url) return false;
      return mcp.linear
        .checkIssueActioned(ping.url, ping.timestamp)
        .catch(() => false);
    }
    // P2 has no clean comment-fetch primitive; stays unchecked.
    default:
      return false;
  }
}

function extractZendeskRef(pingId: string): string | null {
  // Ping ids look like `zendesk:<ticketId>:<commentId>`. Pull the ticket
  // id back out for the actioned check when the URL isn't present.
  const m = /^zendesk:([^:]+):/.exec(pingId);
  return m ? m[1]! : null;
}

/**
 * Fan out per-source detection across the pings list (parallel) and
 * write each verdict to the cache. Returns counts the UI can show as
 * a toast.
 */
export async function recomputeActioned(
  pings: PingActionedInput[],
): Promise<{ checked: number; actioned: number }> {
  if (pings.length === 0) return { checked: 0, actioned: 0 };
  const verdicts = await Promise.all(
    pings.map(async (p) => ({ id: p.id, actioned: await detectActioned(p) })),
  );
  for (const v of verdicts) {
    await writeVerdict(v.id, v.actioned);
  }
  return {
    checked: verdicts.length,
    actioned: verdicts.filter((v) => v.actioned).length,
  };
}
