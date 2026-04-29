import "server-only";

import {
  type FollowUp,
  type Project,
  type ProjectStatus,
  type Vault,
} from "@smithers/vault";

import { loadConfig } from "./config";

export type StallSeverity =
  | "force_decide"
  | "escalate"
  | "nudge"
  | "next_nudge_upcoming";

export interface StallItem {
  stall_id: string;
  severity: StallSeverity;
  title: string;
  /** Sub-line: project, days, status note. */
  context: string;
  /** Days overdue (positive) or days until next_nudge (positive). */
  days: number;
  project_slug?: string;
  project_name?: string;
  project_status?: ProjectStatus;
  /** When the stall comes from a follow-up, this is the row's id — used for the Compose Nudge action. */
  follow_up_id?: string;
}

export interface StallSummary {
  items: StallItem[];
  /** Counts by severity for header badges. */
  counts: Record<StallSeverity, number>;
}

interface DetectInput {
  vault: Vault;
  now?: Date;
}

/**
 * Detect stalls in the vault: overdue follow-ups (3 severities) plus
 * upcoming next-nudge dates. Hot/Active demote and launched-closeout
 * are deferred to v2 — they need real activity data via MCP, and vault
 * file mtime is too noisy a proxy.
 */
export async function detectStalls(input: DetectInput): Promise<StallSummary> {
  const cfg = await loadConfig();
  const now = input.now ?? new Date();
  const t = cfg.stall_thresholds;

  const projects = await input.vault.listProjects();
  const projectsByName = new Map(
    projects.map((p) => [p.name.toLowerCase(), p]),
  );

  const items: StallItem[] = [];

  // Follow-up stalls.
  const fu = await input.vault
    .listFollowUps()
    .catch(() => ({ active: [] as FollowUp[], resolved: [] as FollowUp[] }));
  for (const row of fu.active) {
    const days = computeDaysOverdue(row, now);
    if (days === undefined) continue;
    const project = matchProject(row.project, projectsByName);
    const severity = classifyFollowUp(days, t);
    if (!severity) continue;
    items.push(buildFollowUpStall(row, project, days, severity));
  }

  // Cold-project next-nudge reminders.
  for (const project of projects) {
    if (!project.next_nudge) continue;
    const daysUntil = computeDaysUntil(project.next_nudge, now);
    if (daysUntil === undefined) continue;
    if (daysUntil < 0) continue; // already past — handled separately if we ever add that bucket
    if (daysUntil > t.next_nudge_lookahead_days) continue;
    items.push(buildNextNudgeStall(project, daysUntil));
  }

  // Sort: severity priority first, then days descending within bucket.
  items.sort((a, b) => {
    const pa = severityPriority(a.severity);
    const pb = severityPriority(b.severity);
    if (pa !== pb) return pa - pb;
    return b.days - a.days;
  });

  const counts: Record<StallSeverity, number> = {
    force_decide: 0,
    escalate: 0,
    nudge: 0,
    next_nudge_upcoming: 0,
  };
  for (const it of items) counts[it.severity]++;

  return { items, counts };
}

// --- internals ----------------------------------------------------------

function classifyFollowUp(
  daysOverdue: number,
  t: {
    follow_up_nudge_days: number;
    follow_up_escalate_days: number;
    follow_up_force_decide_days: number;
  },
): StallSeverity | null {
  if (daysOverdue >= t.follow_up_force_decide_days) return "force_decide";
  if (daysOverdue >= t.follow_up_escalate_days) return "escalate";
  if (daysOverdue >= t.follow_up_nudge_days) return "nudge";
  return null;
}

function severityPriority(s: StallSeverity): number {
  // Lower = more urgent; force_decide first.
  switch (s) {
    case "force_decide":
      return 0;
    case "escalate":
      return 1;
    case "nudge":
      return 2;
    case "next_nudge_upcoming":
      return 3;
  }
}

function buildFollowUpStall(
  row: FollowUp,
  project: Project | undefined,
  days: number,
  severity: StallSeverity,
): StallItem {
  return {
    stall_id: `fu:${row.follow_up_id}`,
    severity,
    title: row.task,
    context: `${row.project} · ${days}d overdue`,
    days,
    project_slug: project?.slug,
    project_name: project?.name,
    project_status: project?.status,
    follow_up_id: row.follow_up_id,
  };
}

function buildNextNudgeStall(project: Project, daysUntil: number): StallItem {
  return {
    stall_id: `next_nudge:${project.slug}`,
    severity: "next_nudge_upcoming",
    title: `Touchpoint reminder for ${project.name}`,
    context:
      daysUntil === 0
        ? `due today (${project.next_nudge})`
        : `due in ${daysUntil}d (${project.next_nudge})`,
    days: daysUntil,
    project_slug: project.slug,
    project_name: project.name,
    project_status: project.status,
  };
}

function computeDaysOverdue(
  row: FollowUp,
  now: Date,
): number | undefined {
  const reference = row.follow_up_by ?? row.sent;
  if (!reference) return undefined;
  const ts = Date.parse(reference);
  if (Number.isNaN(ts)) return undefined;
  return Math.floor((now.getTime() - ts) / 86_400_000);
}

function computeDaysUntil(
  iso: string,
  now: Date,
): number | undefined {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return undefined;
  return Math.ceil((ts - now.getTime()) / 86_400_000);
}

function matchProject(
  haystack: string,
  byName: Map<string, Project>,
): Project | undefined {
  const lower = haystack.toLowerCase();
  for (const [name, project] of byName) {
    if (lower.includes(name) || name.includes(lower)) return project;
    if (project.partner && lower.includes(project.partner.toLowerCase())) {
      return project;
    }
  }
  return undefined;
}
