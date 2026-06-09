import "server-only";

import type {
  ActivityEvent,
  LinearProjectUpdate,
} from "@smithers/mcp-client";
import type { Draft, Project, ProjectTask, RecentCallSlice } from "@smithers/vault";
import { parseProjectTasks, splitTasks } from "@smithers/vault";

import { loadConfig } from "./config";
import { getMcpClient } from "./mcp";
import { getVault } from "./vault";

export type { RecentCallSlice };

/**
 * Per-project facts assembled for the weekly update generator. The
 * agent receives this as the "what happened" raw material; it composes
 * the prose summary from these bundles in whatever format the user has
 * configured.
 */
export interface ProjectFacts {
  slug: string;
  name: string;
  partner?: string;
  status: string;
  /** Activity events from listProjectActivity, scoped to the week window, newest first. */
  events: ActivityEvent[];
  /** Linear project updates posted during the week, newest first. */
  linearUpdates: LinearProjectUpdate[];
  /** Calls analyzed during the week (vault Call Notes/), newest first. */
  recentCalls: RecentCallSlice[];
  /** Drafts touched during the week (vault Drafts/), newest first. */
  recentDrafts: Draft[];
  /**
   * Outbound Zendesk replies the user (identity.email) sent on this
   * project during the week. Filtered from `events` so the agent
   * doesn't have to re-derive the signal from event_lines. Newest
   * first; capped upstream.
   */
  myZendeskReplies: Array<{
    date: string;
    ticket_id?: string;
    subject?: string;
    excerpt?: string;
  }>;
  /**
   * Currently-open tasks parsed from the project body's checkboxes.
   * Used by the weekly-update agent to seed the This Week section.
   * Capped at a sane number so long backlogs don't blow up the prompt.
   */
  openTasks: ProjectTask[];
}

export interface WeeklyFacts {
  /**
   * ISO week id of the *posting* week — when the update is published,
   * not when the activity happened. The update labelled "Week N"
   * debriefs Week N-1's activity and plans Week N's work.
   */
  iso_week: string;
  /** Monday of the posting week (UTC, YYYY-MM-DD). */
  week_start: string;
  /** Sunday of the posting week (UTC, YYYY-MM-DD). */
  week_end: string;
  /**
   * Monday of the debrief week (UTC) — i.e. the previous week, which
   * the activity events + outbound replies in `projects` were pulled
   * from. The agent's "Last Week" section covers this range.
   */
  debrief_week_start: string;
  /** Sunday of the debrief week (UTC). */
  debrief_week_end: string;
  projects: ProjectFacts[];
}

/**
 * Compute the Monday of the ISO week for a given date. ISO weeks start
 * on Monday and the week containing Jan 4 is week 1. Returns
 * `{ year, week, monday }` where year/week match Linear's URL pattern
 * (`week-19-4-8-may-2026`).
 */
export function isoWeekParts(date: Date): {
  year: number;
  week: number;
  monday: Date;
} {
  // Copy and shift to Thursday in current week — ISO 8601 trick: a year
  // is the year that owns the Thursday of the week.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sun=0 → 7
  // Monday of the current week.
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  // Thursday of the current week (for year computation).
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year, week, monday };
}

export function isoWeekId(date: Date): string {
  const { year, week } = isoWeekParts(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Parse "2026-W19" into the Monday Date for that week.
 */
export function isoWeekToMonday(isoWeek: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/i.exec(isoWeek);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  // Find Jan 4 (always in week 1) and walk back to that week's Monday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (day - 1));
  // Add (week - 1) * 7 days.
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return target;
}

/**
 * Build the facts bundle for one ISO week. Pulls activity for every
 * partner/team project (regardless of whether the week contains
 * activity for it — the report lists open projects too). Sequential
 * per-project rather than parallel so we don't stampede ContextA8C.
 */
export async function collectWeeklyFacts(
  isoWeek: string,
): Promise<WeeklyFacts | null> {
  // isoWeek = the *posting* week. The update labelled "Week N" debriefs
  // the previous week (Week N-1) and plans Week N's work — so activity
  // collection targets Week N-1's date range, not Week N's. Today
  // (Tuesday of W24) generating an update means: header reads Week 24,
  // Last Week content covers W23 activity, This Week content forecasts
  // W24 plans.
  const postingMonday = isoWeekToMonday(isoWeek);
  if (!postingMonday) return null;
  const postingSunday = new Date(postingMonday);
  postingSunday.setUTCDate(postingMonday.getUTCDate() + 6);
  const weekStart = postingMonday.toISOString().slice(0, 10);
  const weekEnd = postingSunday.toISOString().slice(0, 10);

  const debriefMonday = new Date(postingMonday);
  debriefMonday.setUTCDate(postingMonday.getUTCDate() - 7);
  const debriefSunday = new Date(debriefMonday);
  debriefSunday.setUTCDate(debriefMonday.getUTCDate() + 6);
  const debriefWeekStart = debriefMonday.toISOString().slice(0, 10);
  const debriefWeekEnd = debriefSunday.toISOString().slice(0, 10);

  // Activity window is the DEBRIEF week (Week N-1) — that's the period
  // being recapped.
  const sinceIso = debriefMonday.toISOString();
  const untilIso = new Date(debriefSunday.getTime() + 86_400_000).toISOString();

  const vault = await getVault();
  const mcp = await getMcpClient();
  const cfg = await loadConfig();
  const selfEmail = (cfg.identity.email ?? "").trim().toLowerCase();
  const selfName = (cfg.identity.name ?? "").trim().toLowerCase();
  const allProjects = await vault.listProjects().catch(() => []);
  const inScope = allProjects.filter(
    (p) =>
      (p.kind === "partner" || p.kind === "team") &&
      (p.status === "active" || p.status === "hot" || p.status === "at-risk"),
  );

  const allCalls = await vault
    .listRecentCallSlices({ since: sinceIso, until: untilIso })
    .catch(() => [] as RecentCallSlice[]);
  const allDrafts = await vault.listDrafts().catch(() => []);

  const projectsFacts: ProjectFacts[] = [];
  for (const project of inScope) {
    const events = await fetchActivity(project, sinceIso, untilIso);
    const linearUpdates = project.linear_project_id
      ? await mcp.linear
          .getProjectUpdates(project.linear_project_id)
          .then((updates) =>
            updates.filter(
              (u) => u.createdAt >= sinceIso && u.createdAt < untilIso,
            ),
          )
          .catch(() => [] as LinearProjectUpdate[])
      : [];
    const recentCalls = allCalls
      .filter(
        (c) =>
          c.project_slug === project.slug &&
          c.recorded_at >= sinceIso &&
          c.recorded_at < untilIso,
      )
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    const recentDrafts = allDrafts.filter((d) => {
      if (d.project_slug !== project.slug) return false;
      const ts = d.modified_at;
      return ts && ts >= sinceIso && ts < untilIso;
    });
    const myZendeskReplies = filterMyZendeskReplies(events, selfEmail, selfName);
    // Read the body fresh — project.body isn't on the listProjects shape.
    // readProjectDetail is the canonical way to pull the body for parsing.
    const detail = await vault.readProjectDetail(project.slug).catch(() => null);
    const openTasks = detail
      ? (() => {
          const tasks = parseProjectTasks(detail.body);
          const { open } = splitTasks(tasks);
          return open.slice(0, 25);
        })()
      : [];
    projectsFacts.push({
      slug: project.slug,
      name: project.name,
      partner: project.partner,
      status: project.status,
      events,
      linearUpdates,
      recentCalls,
      recentDrafts,
      myZendeskReplies,
      openTasks,
    });
  }

  return {
    iso_week: isoWeek,
    week_start: weekStart,
    week_end: weekEnd,
    debrief_week_start: debriefWeekStart,
    debrief_week_end: debriefWeekEnd,
    projects: projectsFacts,
  };
}

/**
 * Pull outbound Zendesk comments authored by the user (Katie's nudges
 * + replies). Every team Zendesk reply leaves via the shared persona
 * `concierge@wordpress.com`, so actor.email / is_external can't
 * distinguish a Katie reply from another TAM's or from the partner
 * — they all look "external" because wordpress.com isn't an
 * Automattic domain.
 *
 * The only reliable signal is the comment body itself. TAMs sign
 * their replies; the partner doesn't sign as "Katie McCanna." Match
 * the user's identity.name as a word-boundary substring of the
 * comment body — typically the signature line.
 *
 * False positives are rare: a partner thanking "Katie" by first
 * name only would slip through if we matched on first name, so we
 * require the full name when it's available. Falls back to first
 * name (with stricter signature-position check) when only first
 * name is configured.
 */
function filterMyZendeskReplies(
  events: ActivityEvent[],
  _selfEmail: string,
  selfName: string,
): Array<{ date: string; ticket_id?: string; subject?: string; excerpt?: string }> {
  if (!selfName) return [];
  const nameMatches = makeAuthorNameMatcher(selfName);
  if (!nameMatches) return [];
  const matches = events.filter(
    (e) =>
      e.source === "zendesk" &&
      e.kind === "zendesk-comment" &&
      nameMatches(e.excerpt ?? ""),
  );
  return matches.slice(0, 8).map((e) => {
    const ticketId = e.id.startsWith("zendesk:")
      ? e.id.split(":")[1]
      : undefined;
    return {
      date: e.timestamp.slice(0, 10),
      ticket_id: ticketId,
      subject: e.title,
      excerpt: e.excerpt,
    };
  });
}

/**
 * Build a predicate that detects the user's name in a comment body.
 * Multi-word names get an anywhere-in-body match (signatures almost
 * always include the surname). Single-word names get the stricter
 * "appears in the trailing third of the body" check — that's where
 * signatures sit, and avoids partner-greeting false positives like
 * "Hi Katie, ..." at the top.
 */
function makeAuthorNameMatcher(rawName: string): ((body: string) => boolean) | null {
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  // Escape regex meta in the configured name so an O'Connor or
  // Smith-Jones doesn't blow up the regex.
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    return (body) => re.test(body);
  }
  // Single-word name — only count when it appears in the signature
  // zone (last ~30% of the body) to avoid partner greetings.
  const re = new RegExp(`\\b${escaped}\\b`, "i");
  return (body) => {
    if (!body) return false;
    const tail = body.slice(Math.floor(body.length * 0.7));
    return re.test(tail);
  };
}

async function fetchActivity(
  project: Project,
  sinceIso: string,
  untilIso: string,
): Promise<ActivityEvent[]> {
  const mcp = await getMcpClient();
  const result = await mcp.contextA8C
    .listProjectActivity({
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
    })
    .catch(() => null);
  if (!result) return [];
  const data = result.ok ? result.data : (result.cachedData ?? []);
  return data
    .filter((e) => e.timestamp >= sinceIso && e.timestamp < untilIso)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
