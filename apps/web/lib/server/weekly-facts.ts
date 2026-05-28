import "server-only";

import type {
  ActivityEvent,
  LinearProjectUpdate,
} from "@smithers/mcp-client";
import type { Draft, Project, RecentCallSlice } from "@smithers/vault";

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
}

export interface WeeklyFacts {
  /** ISO week id, e.g. "2026-W19". */
  iso_week: string;
  /** Monday of the week (UTC, YYYY-MM-DD). */
  week_start: string;
  /** Sunday of the week (UTC, YYYY-MM-DD). */
  week_end: string;
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
  const monday = isoWeekToMonday(isoWeek);
  if (!monday) return null;
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const weekStart = monday.toISOString().slice(0, 10);
  const weekEnd = sunday.toISOString().slice(0, 10);
  const sinceIso = monday.toISOString();
  const untilIso = new Date(sunday.getTime() + 86_400_000).toISOString();

  const vault = await getVault();
  const mcp = await getMcpClient();
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
    projectsFacts.push({
      slug: project.slug,
      name: project.name,
      partner: project.partner,
      status: project.status,
      events,
      linearUpdates,
      recentCalls,
      recentDrafts,
    });
  }

  return {
    iso_week: isoWeek,
    week_start: weekStart,
    week_end: weekEnd,
    projects: projectsFacts,
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
