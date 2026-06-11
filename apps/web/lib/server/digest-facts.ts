import "server-only";

import type { ActivityEvent } from "@smithers/mcp-client";
import type { Draft, FollowUp, RecentCallSlice } from "@smithers/vault";

import { loadConfig } from "./config";
import { getMcpClient } from "./mcp";
import { getVault } from "./vault";
import { isoWeekToMonday } from "./weekly-facts";

/**
 * Candidate "moment worth remembering" for the weekly highlight
 * suggestion engine. Pulled from cheap, already-available vault + MCP
 * state — no AI in the collector. The agent ranks + writes copy.
 */
export interface HighlightCandidate {
  /**
   * Discriminator the agent uses for category-aware ranking + the
   * "Add to highlight" UI uses for the icon.
   */
  category:
    | "launch"
    | "urgent-response"
    | "brief-or-handoff"
    | "decision"
    | "sustained-engagement"
    | "follow-up-resolved"
    | "call-processed";
  /** One-line summary (e.g. "Body Dao Acupuncture launched"). */
  title: string;
  /** Optional 1-2 sentence context surfaced to the agent as evidence. */
  context?: string;
  /** Project slug the candidate is attached to, when applicable. */
  project_slug?: string;
  project_name?: string;
  /** ISO timestamp the moment occurred (best-effort). */
  occurred_at?: string;
}

export interface DigestCandidates {
  iso_week: string;
  /** Debrief window — Monday-Sunday of the week the highlight covers. */
  window_start: string;
  window_end: string;
  candidates: HighlightCandidate[];
}

export async function collectDigestCandidates(
  isoWeek: string,
): Promise<DigestCandidates | null> {
  const monday = isoWeekToMonday(isoWeek);
  if (!monday) return null;
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const sinceIso = monday.toISOString();
  const untilIso = new Date(sunday.getTime() + 86_400_000).toISOString();
  const windowStart = monday.toISOString().slice(0, 10);
  const windowEnd = sunday.toISOString().slice(0, 10);

  const vault = await getVault();
  const cfg = await loadConfig();
  const selfName = (cfg.identity.name ?? "").trim();
  const selfNameLower = selfName.toLowerCase();

  const candidates: HighlightCandidate[] = [];

  // --- Launches: projects with status=launched, file mtime within window ---
  const allProjects = await vault.listProjects().catch(() => []);
  for (const p of allProjects) {
    if (p.status !== "launched") continue;
    if (p.modified_at < sinceIso || p.modified_at >= untilIso) continue;
    candidates.push({
      category: "launch",
      title: `${p.name} launched`,
      context: p.partner
        ? `Partner project: ${p.partner}. Project file marked launched ${p.modified_at.slice(0, 10)}.`
        : `Project file marked launched ${p.modified_at.slice(0, 10)}.`,
      project_slug: p.slug,
      project_name: p.name,
      occurred_at: p.modified_at,
    });
  }

  // --- Calls processed (Call Notes/) with analyzed_at in window ---
  const calls = await vault
    .listRecentCallSlices({ since: sinceIso, until: untilIso })
    .catch(() => [] as RecentCallSlice[]);
  for (const c of calls) {
    if (!c.recorded_at || c.recorded_at < sinceIso || c.recorded_at >= untilIso)
      continue;
    candidates.push({
      category: "call-processed",
      title: `Processed: ${c.title}`,
      context: c.summary
        ? truncate(c.summary, 220)
        : `Call on ${c.recorded_at.slice(0, 10)} analyzed + saved to Call Notes/.`,
      project_slug: c.project_slug ?? undefined,
      occurred_at: c.recorded_at,
    });
  }

  // --- Drafts saved (briefs + handoffs surface here when written from Smithers) ---
  const drafts = await vault.listDrafts().catch(() => [] as Draft[]);
  for (const d of drafts) {
    if (!d.modified_at) continue;
    if (d.modified_at < sinceIso || d.modified_at >= untilIso) continue;
    // Only surface drafts the user actually shipped (state=archived =
    // sent/done) so in-flight churn doesn't drown the digest.
    if (d.state !== "archived") continue;
    candidates.push({
      category: "brief-or-handoff",
      title: `Shipped draft: ${truncate(d.title || d.draft_id, 80)}`,
      context: `Archived ${d.modified_at.slice(0, 10)}. Project: ${d.project_slug ?? "unknown"}.`,
      project_slug: d.project_slug ?? undefined,
      occurred_at: d.modified_at,
    });
  }

  // --- Follow-ups resolved during the window ---
  // Resolved follow-ups don't carry a "resolved_at" timestamp in the
  // current vault shape; treat the file's modified_at as a proxy and
  // surface anything in the resolved bucket that *also* shows up as
  // mentioning this week's date in the resolved row. Conservative: just
  // pull a count, not specific rows — the agent gets "you resolved N
  // follow-ups this week" as a single candidate when N > 0.
  const followUps = await vault
    .listFollowUps()
    .catch(() => ({ active: [], resolved: [] }) as {
      active: FollowUp[];
      resolved: FollowUp[];
    });
  // Match resolved rows whose `sent` date falls in the window —
  // imperfect but cheaper than rewriting the parser.
  const resolvedThisWeek = followUps.resolved.filter(
    (f) => f.sent && f.sent >= windowStart && f.sent <= windowEnd,
  );
  if (resolvedThisWeek.length > 0) {
    candidates.push({
      category: "follow-up-resolved",
      title: `Resolved ${resolvedThisWeek.length} follow-up${resolvedThisWeek.length === 1 ? "" : "s"} this week`,
      context: resolvedThisWeek
        .slice(0, 5)
        .map((f) => `• ${truncate(f.task, 90)} (${f.project})`)
        .join("\n"),
    });
  }

  // --- Per-project Zendesk signals: gather activity per project to
  //     detect "sustained engagement" and "fast urgent responses." ---
  // We pull activity per partner / team project. Sequential to avoid
  // stampeding ContextA8C (matches collectWeeklyFacts's strategy).
  const inScope = allProjects.filter(
    (p) =>
      (p.kind === "partner" || p.kind === "team") &&
      (p.status === "active" || p.status === "hot" || p.status === "at-risk"),
  );
  const mcp = await getMcpClient();
  for (const project of inScope) {
    let events: ActivityEvent[] = [];
    try {
      const result = await mcp.contextA8C.listProjectActivity({
        project_slug: project.slug,
        project_name: project.name,
        refs: {
          github_repo: project.github_repo,
          linear_project_id: project.linear_project_id,
          linear_project_slug: project.linear_project_slug,
          zendesk_tickets: project.zendesk_tickets?.map((t) => t.id),
          slack_channel: project.slack_channel,
          partner: project.partner,
        },
        limit: 60,
        since: sinceIso,
      });
      const data = result.ok ? result.data : (result.cachedData ?? []);
      events = data.filter(
        (e) => e.timestamp >= sinceIso && e.timestamp < untilIso,
      );
    } catch {
      continue;
    }

    // Outbound replies the user authored (signature-detected).
    const myReplies = events.filter(
      (e) =>
        e.source === "zendesk" &&
        e.kind === "zendesk-comment" &&
        selfNameLower &&
        e.excerpt?.toLowerCase().includes(selfNameLower),
    );

    if (myReplies.length >= 3) {
      candidates.push({
        category: "sustained-engagement",
        title: `${myReplies.length} replies to ${project.name} this week`,
        context: `Top tickets touched: ${myReplies
          .slice(0, 3)
          .map((r) => r.title?.slice(0, 60))
          .filter(Boolean)
          .join(" · ")}`,
        project_slug: project.slug,
        project_name: project.name,
      });
    }

    // Fast urgent responses: external comment followed by an internal
    // (Katie-signed) comment on the same ticket within 4 hours. Pull
    // pairs from the activity stream.
    const ticketGroups = new Map<string, ActivityEvent[]>();
    for (const e of events) {
      if (e.source !== "zendesk" || e.kind !== "zendesk-comment") continue;
      // id shape: "zendesk:<ticketId>:<commentId>"
      const ticketId = e.id.split(":")[1];
      if (!ticketId) continue;
      const arr = ticketGroups.get(ticketId) ?? [];
      arr.push(e);
      ticketGroups.set(ticketId, arr);
    }
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    for (const [ticketId, ticketEvents] of ticketGroups) {
      const sorted = [...ticketEvents].sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp),
      );
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const cur = sorted[i]!;
        if (!prev.actor?.is_external) continue;
        const curBody = cur.excerpt?.toLowerCase() ?? "";
        if (!selfNameLower || !curBody.includes(selfNameLower)) continue;
        const gapMs =
          new Date(cur.timestamp).getTime() -
          new Date(prev.timestamp).getTime();
        if (gapMs > 0 && gapMs <= FOUR_HOURS_MS) {
          const hours = (gapMs / (60 * 60 * 1000)).toFixed(1);
          candidates.push({
            category: "urgent-response",
            title: `Fast turnaround on ${project.name} (#${ticketId})`,
            context: `${prev.actor?.name ?? "Partner"} sent ${prev.title?.slice(0, 80) ?? "an inbound"} at ${prev.timestamp.slice(11, 16)}; you replied within ${hours}h.`,
            project_slug: project.slug,
            project_name: project.name,
            occurred_at: cur.timestamp,
          });
          // One urgent-response per ticket — don't fire on every pair.
          break;
        }
      }
    }
  }

  // De-dupe by (category, title) — rare but possible when the same
  // signal triggers from two angles.
  const seen = new Set<string>();
  const deduped: HighlightCandidate[] = [];
  for (const c of candidates) {
    const key = `${c.category}:${c.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  return {
    iso_week: isoWeek,
    window_start: windowStart,
    window_end: windowEnd,
    candidates: deduped,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trim() + "…";
}
