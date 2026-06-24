import "server-only";

import type { Project } from "@smithers/vault";

import { getMcpClient } from "./mcp";
import { getVault } from "./vault";

export interface UpcomingDeadlineRow {
  /** Vault project slug — the workbench link target. */
  project_slug: string;
  /** Vault project display name. */
  project_name: string;
  /** Linear project name (often equals vault name, but not always — keep both). */
  linear_name: string;
  /** Linear project URL. */
  linear_url: string;
  /** ISO date (YYYY-MM-DD). */
  target_date: string;
  /**
   * Whole-day count from today (UTC midnight) to target_date. Negative
   * means the deadline has passed but the project's still open — we
   * include those because "overdue" is more urgent than "due soon".
   */
  days_until: number;
  /** Linear health flag — passed through so the UI can color the row. */
  health: string;
  /** Current state name — used to suppress completed/cancelled projects below. */
  state: string;
}

/**
 * Cross-project rollup of Linear projects with a `targetDate` within
 * the configured window (plus any that are already overdue and not
 * yet completed). Returned sorted by soonest-first; overdue entries
 * surface at the very top with negative `days_until`.
 *
 * Skips projects without a `linear_project_id`, the Linear call
 * fails, the project is in a completed/cancelled state, or the
 * targetDate is absent. Each Linear call is independent — one slow
 * project doesn't block the others.
 */
export async function listUpcomingDeadlines(args: {
  windowDays: number;
  projects: Project[];
}): Promise<UpcomingDeadlineRow[]> {
  const mcp = await getMcpClient();
  const candidates = args.projects.filter(
    (p): p is Project & { linear_project_id: string } =>
      Boolean(p.linear_project_id),
  );

  const fetched = await Promise.all(
    candidates.map(async (p) => {
      const lp = await mcp.linear
        .getProject(p.linear_project_id)
        .catch(() => null);
      return lp ? { project: p, linearProject: lp } : null;
    }),
  );

  const todayMs = startOfTodayUtcMs();
  const windowMs = args.windowDays * 24 * 60 * 60 * 1000;
  const cutoffMs = todayMs + windowMs;

  const rows: UpcomingDeadlineRow[] = [];
  for (const entry of fetched) {
    if (!entry) continue;
    const { project, linearProject } = entry;
    if (!linearProject.targetDate) continue;
    if (isInactiveState(linearProject.state?.type)) continue;
    const targetMs = Date.parse(linearProject.targetDate);
    if (Number.isNaN(targetMs)) continue;
    // Filter: anything overdue OR within the window. Items past the
    // window are dropped quietly.
    if (targetMs > cutoffMs) continue;
    const daysUntil = Math.round((targetMs - todayMs) / (24 * 60 * 60 * 1000));
    rows.push({
      project_slug: project.slug,
      project_name: project.name,
      linear_name: linearProject.name,
      linear_url: linearProject.url,
      target_date: linearProject.targetDate.slice(0, 10),
      days_until: daysUntil,
      health: linearProject.health ?? "onTrack",
      state: linearProject.state?.name ?? "",
    });
  }

  // Closest first; overdue (negative) outranks "due in 3 days".
  rows.sort((a, b) => a.days_until - b.days_until);
  return rows;
}

function startOfTodayUtcMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isInactiveState(stateType: string | undefined): boolean {
  if (!stateType) return false;
  return stateType === "completed" || stateType === "canceled";
}
