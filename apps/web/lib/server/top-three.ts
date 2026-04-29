import "server-only";

import type { Ping } from "@smithers/mcp-client";
import {
  parseProjectTasks,
  type Draft,
  type FollowUp,
  type Project,
  type ProjectStatus,
  type Vault,
} from "@smithers/vault";

/**
 * Locked-in scoring rules for Top 3 candidate ranking. Numbers come from
 * the design doc; keep them in one place so we can tune without hunting.
 */
const STATUS_WEIGHT: Record<ProjectStatus, number> = {
  hot: 3,
  active: 2,
  "at-risk": 2,
  launched: 2,
  research: 1,
  planning: 1,
  secondary: 1,
  cold: 1,
  archived: 0,
};

const FOLLOW_UP_NUDGE_DAYS = 10;
const FOLLOW_UP_ESCALATE_DAYS = 21;
const FOLLOW_UP_FORCE_DECIDE_DAYS = 30;
const CARRY_AGE_THRESHOLD_DAYS = 3;

export type CandidateSource =
  | "ping"
  | "follow_up"
  | "project_task"
  | "draft";

export interface ScoreReason {
  reason: string;
  delta: number;
}

export interface TopThreeCandidate {
  candidate_id: string;
  source: CandidateSource;
  /** One-line description rendered as the row title. */
  task: string;
  /** Optional sub-line: project, partner, age, etc. */
  context?: string;
  /** When the candidate maps to a project, link to /projects/<slug>. */
  project_slug?: string;
  project_name?: string;
  project_status?: ProjectStatus;
  /** Total score; higher = better. */
  score: number;
  /** Each entry is one rule's contribution. UI tooltip shows the breakdown. */
  score_breakdown: ScoreReason[];
  /** Original-source link the user can jump to. */
  href?: string;
}

export interface BuildCandidatesInput {
  vault: Vault;
  pings: Ping[];
  /** Now (ISO or Date) — passed in so tests can stub it. */
  now?: Date;
}

/**
 * Walk vault data + pings, score each candidate per the locked rules,
 * and return them sorted highest-first. Caller passes the top-N to the
 * LLM agent or renders them directly when no API key is configured.
 */
export async function buildTopThreeCandidates(
  input: BuildCandidatesInput,
): Promise<TopThreeCandidate[]> {
  const now = input.now ?? new Date();
  const projects = await input.vault.listProjects();
  const projectsBySlug = new Map(projects.map((p) => [p.slug, p]));
  const projectsByName = new Map(
    projects.map((p) => [p.name.toLowerCase(), p]),
  );

  const candidates: TopThreeCandidate[] = [];

  // Pings — high signal: someone is actively waiting on you.
  for (const ping of input.pings) {
    const project = ping.project_match
      ? projectsBySlug.get(ping.project_match.project_slug)
      : undefined;
    candidates.push(buildPingCandidate(ping, project, now));
  }

  // Follow-ups — fuzzy-match to projects so we can reuse status weight.
  const followUpRows = await input.vault
    .listFollowUps()
    .catch(() => ({ active: [] as FollowUp[], resolved: [] as FollowUp[] }));
  for (const fu of followUpRows.active) {
    const project = matchProjectByName(fu.project, projectsByName);
    candidates.push(buildFollowUpCandidate(fu, project, now));
  }

  // In-flight drafts — surfaces stalled drafts that need finishing.
  const drafts = await input.vault.listDrafts().catch(() => [] as Draft[]);
  const draftSlugs = new Set(
    drafts.filter((d) => d.state === "in-progress").map((d) => d.project_slug),
  );
  for (const draft of drafts) {
    if (draft.state !== "in-progress") continue;
    const project = draft.project_slug
      ? projectsBySlug.get(draft.project_slug)
      : undefined;
    candidates.push(buildDraftCandidate(draft, project, now));
  }

  // Open project tasks — read each project's body and pull `[ ]` items.
  for (const project of projects) {
    const detail = await input.vault
      .readProjectDetail(project.slug)
      .catch(() => null);
    if (!detail) continue;
    const tasks = parseProjectTasks(detail.body);
    for (const task of tasks) {
      if (task.done) continue;
      const hasInFlightDraft = draftSlugs.has(project.slug);
      candidates.push(
        buildProjectTaskCandidate(project, task, hasInFlightDraft),
      );
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Sentinel score added to pinned candidates so they sort to the top.
 * Larger than any natural score the rules engine can produce so pinned
 * items always win, regardless of how aggressive the underlying signals
 * are.
 */
const PIN_SCORE_BOOST = 1_000;

/**
 * Apply pin/demote state to a candidate list. Demoted candidates are
 * filtered out entirely; pinned candidates get a sentinel score boost
 * (and a "pinned" entry in their breakdown so the UI can label them)
 * and re-sort to the top. Pure function — easy to unit-test without
 * touching SQLite.
 */
export function applyTop3UserActions(
  candidates: TopThreeCandidate[],
  pinnedIds: ReadonlySet<string>,
  demotedIds: ReadonlySet<string>,
): TopThreeCandidate[] {
  if (pinnedIds.size === 0 && demotedIds.size === 0) return candidates;
  const out: TopThreeCandidate[] = [];
  for (const c of candidates) {
    if (demotedIds.has(c.candidate_id)) continue;
    if (pinnedIds.has(c.candidate_id)) {
      out.push({
        ...c,
        score: c.score + PIN_SCORE_BOOST,
        score_breakdown: [
          { reason: "pinned by you", delta: PIN_SCORE_BOOST },
          ...c.score_breakdown,
        ],
      });
    } else {
      out.push(c);
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Whether the user has elected to skip the LLM step entirely (no API key
 * configured, or the agent failed). UI uses this to decide between
 * "rules-based picks" and "LLM-refined picks" copy.
 */
export function pickRulesBasedTop3(
  candidates: TopThreeCandidate[],
): TopThreeCandidate[] {
  return candidates.slice(0, 3);
}

// --- candidate builders -------------------------------------------------

function buildPingCandidate(
  ping: Ping,
  project: Project | undefined,
  now: Date,
): TopThreeCandidate {
  const breakdown: ScoreReason[] = [];
  const statusWeight = project ? STATUS_WEIGHT[project.status] : 1;
  breakdown.push({
    reason: `project status: ${project?.status ?? "unknown"}`,
    delta: statusWeight,
  });
  // Pings inherently demand a reply — they're the strongest "decision-required" signal.
  breakdown.push({ reason: "inbound ping awaiting reply", delta: 3 });

  const ageHours = (now.getTime() - Date.parse(ping.timestamp)) / 36e5;
  if (Number.isFinite(ageHours) && ageHours < 2) {
    breakdown.push({ reason: "pinged in last 2h", delta: 2 });
  } else if (Number.isFinite(ageHours) && ageHours < 24) {
    breakdown.push({ reason: "pinged today", delta: 1 });
  }

  const score = breakdown.reduce((s, r) => s + r.delta, 0);
  return {
    candidate_id: `ping:${ping.id}`,
    source: "ping",
    task: `Reply to ${ping.from.name} — ${shorten(ping.excerpt, 90)}`,
    context: project
      ? `${project.name} · ${ping.source}`
      : `${ping.from.name} on ${ping.source}`,
    project_slug: project?.slug,
    project_name: project?.name,
    project_status: project?.status,
    score,
    score_breakdown: breakdown,
    href: ping.url,
  };
}

function buildFollowUpCandidate(
  fu: FollowUp,
  project: Project | undefined,
  now: Date,
): TopThreeCandidate {
  const breakdown: ScoreReason[] = [];
  const statusWeight = project ? STATUS_WEIGHT[project.status] : 1;
  breakdown.push({
    reason: `project status: ${project?.status ?? fu.project}`,
    delta: statusWeight,
  });

  const days = computeDaysWaiting(fu, now);
  if (typeof days === "number") {
    if (days >= FOLLOW_UP_FORCE_DECIDE_DAYS) {
      breakdown.push({ reason: `${days}d overdue — force-decide`, delta: 3 });
    } else if (days >= FOLLOW_UP_ESCALATE_DAYS) {
      breakdown.push({ reason: `${days}d overdue — escalate`, delta: 2 });
    } else if (days >= FOLLOW_UP_NUDGE_DAYS) {
      breakdown.push({ reason: `${days}d overdue — nudge`, delta: 1 });
    }
    if (days > CARRY_AGE_THRESHOLD_DAYS) {
      const carry = Math.min(2, (days - CARRY_AGE_THRESHOLD_DAYS) * 0.5);
      if (carry > 0) {
        breakdown.push({
          reason: `carry age (${days}d)`,
          delta: Number(carry.toFixed(1)),
        });
      }
    }
  }
  if (fu.status === "escalated") {
    breakdown.push({ reason: "marked escalated", delta: 1 });
  }

  const score = breakdown.reduce((s, r) => s + r.delta, 0);
  return {
    candidate_id: `follow_up:${fu.follow_up_id}`,
    source: "follow_up",
    task: fu.task,
    context:
      typeof days === "number"
        ? `${fu.project} · waiting ${days}d`
        : fu.project,
    project_slug: project?.slug,
    project_name: project?.name,
    project_status: project?.status,
    score,
    score_breakdown: breakdown,
    href: "/follow-ups",
  };
}

function buildDraftCandidate(
  draft: Draft,
  project: Project | undefined,
  now: Date,
): TopThreeCandidate {
  const breakdown: ScoreReason[] = [];
  const statusWeight = project ? STATUS_WEIGHT[project.status] : 1;
  breakdown.push({
    reason: `project status: ${project?.status ?? "unknown"}`,
    delta: statusWeight,
  });
  // Existing drafts are partial signals — they're worth finishing but
  // don't outrank a force-decide stall. Add a small base bump.
  breakdown.push({ reason: "draft in flight", delta: 1 });

  const ageDays = computeAgeDays(draft.modified_at, now);
  if (typeof ageDays === "number" && ageDays > CARRY_AGE_THRESHOLD_DAYS) {
    const carry = Math.min(2, (ageDays - CARRY_AGE_THRESHOLD_DAYS) * 0.5);
    if (carry > 0) {
      breakdown.push({
        reason: `idle ${ageDays}d`,
        delta: Number(carry.toFixed(1)),
      });
    }
  }

  const score = breakdown.reduce((s, r) => s + r.delta, 0);
  return {
    candidate_id: `draft:${draft.draft_id}`,
    source: "draft",
    task: `Finish draft — ${draft.title}`,
    context:
      typeof ageDays === "number"
        ? `${project?.name ?? draft.project_slug ?? "no project"} · idle ${ageDays}d`
        : project?.name ?? draft.project_slug ?? "no project",
    project_slug: project?.slug,
    project_name: project?.name,
    project_status: project?.status,
    score,
    score_breakdown: breakdown,
    href: "/drafts",
  };
}

function buildProjectTaskCandidate(
  project: Project,
  task: { task_id: string; text: string; section?: string },
  hasInFlightDraft: boolean,
): TopThreeCandidate {
  const breakdown: ScoreReason[] = [];
  const statusWeight = STATUS_WEIGHT[project.status];
  breakdown.push({
    reason: `project status: ${project.status}`,
    delta: statusWeight,
  });
  // Project tasks come from the user's own writing — small base lift
  // because they wrote the task down, but we can't tell stalls without
  // more state.
  breakdown.push({ reason: "user-authored project task", delta: 0.5 });
  if (hasInFlightDraft && /draft|write|send|compose/i.test(task.text)) {
    breakdown.push({
      reason: "draft already in flight",
      delta: -1,
    });
  }

  const score = breakdown.reduce((s, r) => s + r.delta, 0);
  return {
    candidate_id: `project_task:${project.slug}:${task.task_id}`,
    source: "project_task",
    task: task.text,
    context: task.section
      ? `${project.name} · ${task.section}`
      : project.name,
    project_slug: project.slug,
    project_name: project.name,
    project_status: project.status,
    score,
    score_breakdown: breakdown,
    href: `/projects/${project.slug}`,
  };
}

// --- utilities ----------------------------------------------------------

function matchProjectByName(
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

function computeDaysWaiting(
  fu: FollowUp,
  now: Date,
): number | undefined {
  const reference = fu.follow_up_by ?? fu.sent;
  if (!reference) return undefined;
  const ts = Date.parse(reference);
  if (Number.isNaN(ts)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - ts) / 86_400_000));
}

function computeAgeDays(
  iso: string | undefined,
  now: Date,
): number | undefined {
  if (!iso) return undefined;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - ts) / 86_400_000));
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
