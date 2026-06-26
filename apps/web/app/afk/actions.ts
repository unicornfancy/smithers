"use server";

import {
  composeAfkNotes,
  type AfkProjectSlice,
  type ComposeAfkNotesOutput,
} from "@smithers/agents";
import { filterFollowUpsForProject } from "@smithers/vault";

import { getAgentRuntime } from "@/lib/server/agents";
import { loadConfig } from "@/lib/server/config";
import { loadJobContext } from "@/lib/server/job-context";
import { getMcpClient } from "@/lib/server/mcp";
import { loadStyleReference } from "@/lib/server/style";
import { getVault } from "@/lib/server/vault";

/**
 * Compose an AFK (Away From Keyboard) handoff post for the user's
 * active partner/team projects. Pulls per-project Linear state, open
 * Zendesk threads, open follow-ups, and a snippet of latest activity
 * into the per-project sections of the post. Returns markdown + a
 * one-line rationale; nothing is posted anywhere.
 *
 * Caller passes the AFK window (start / end YYYY-MM-DD) and the
 * coverage TAM's handle. Intro_notes is optional free-form prose
 * the agent will use verbatim at the top of the post.
 */
export async function generateAfkPostAction(input: {
  start_date: string;
  end_date: string;
  coverage_handle: string;
  intro_notes?: string;
}): Promise<
  | { ok: true; data: ComposeAfkNotesOutput }
  | {
      ok: false;
      reason: "not-configured" | "validation" | "error";
      message?: string;
    }
> {
  if (!input.start_date || !input.end_date) {
    return { ok: false, reason: "validation", message: "Pick a date range" };
  }
  if (!input.coverage_handle.trim()) {
    return {
      ok: false,
      reason: "validation",
      message: "Coverage handle is required",
    };
  }

  const runtime = await getAgentRuntime();
  if (!runtime) return { ok: false, reason: "not-configured" };

  const cfg = await loadConfig();
  const authorName = cfg.identity.name?.trim() || "Smithers user";

  const vault = await getVault();
  const mcp = await getMcpClient();
  const allProjects = await vault.listProjects().catch(() => []);
  const inScope = allProjects.filter(
    (p) =>
      (p.kind === "partner" || p.kind === "team") &&
      (p.status === "active" || p.status === "hot" || p.status === "at-risk"),
  );

  const followUps = await vault
    .listFollowUps()
    .catch(() => ({ active: [], resolved: [] } as never));

  // Fan-out Linear lookups per project. Sequential keeps the upstream
  // gentle; even at 20 projects this is well under 10s.
  const slices: AfkProjectSlice[] = [];
  for (const project of inScope) {
    const [linearProject, openIssues, updates] = await Promise.all([
      project.linear_project_id
        ? mcp.linear.getProject(project.linear_project_id).catch(() => null)
        : Promise.resolve(null),
      project.linear_project_id
        ? mcp.linear.getProjectIssues(project.linear_project_id).catch(() => [])
        : Promise.resolve([]),
      project.linear_project_id
        ? mcp.linear
            .getProjectUpdates(project.linear_project_id)
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    // Project-scoped active follow-ups (we already have them all from
    // listFollowUps — fuzzy-match the project cell to this project).
    const projectFollowUps = filterFollowUpsForProject(followUps.active, project);

    const attachedTickets = project.zendesk_tickets ?? [];
    const openThreads = attachedTickets
      .filter((t) => {
        const s = (t.status ?? "").toLowerCase();
        return s !== "solved" && s !== "closed";
      })
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        subject: t.subject ?? undefined,
        status: t.status ?? undefined,
        url: `https://automattic.zendesk.com/agent/tickets/${t.id}`,
      }));

    // Primary Zendesk thread = first attached ticket regardless of
    // status. The user wants every per-project section to always
    // carry a Zendesk entry point so the coverage TAM has somewhere
    // to land even when nothing is currently open.
    const primaryAttached = attachedTickets[0];
    const primaryZendesk = primaryAttached
      ? {
          id: primaryAttached.id,
          subject: primaryAttached.subject ?? undefined,
          status: primaryAttached.status ?? undefined,
          url: `https://automattic.zendesk.com/agent/tickets/${primaryAttached.id}`,
        }
      : undefined;

    // Latest Linear update body, capped — gives the agent a recent
    // snapshot to anchor the per-project narrative.
    const latestUpdateBody = (updates ?? [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      ?.body?.trim()
      .slice(0, 280);

    // Issues likely to land in/near the AFK window: exclude
    // completed/cancelled; cap to 3, ordered by dueDate ascending.
    const liveIssues = (openIssues ?? []).filter((i) => {
      const t = i.state?.type ?? "";
      return t !== "completed" && t !== "cancelled";
    });
    liveIssues.sort((a, b) => {
      const ad = a.dueDate ?? "9999-12-31";
      const bd = b.dueDate ?? "9999-12-31";
      return ad.localeCompare(bd);
    });
    const trimmedIssues = liveIssues.slice(0, 3).map((i) => ({
      identifier: i.identifier,
      title: i.title,
      state: i.state?.name ?? undefined,
    }));

    slices.push({
      slug: project.slug,
      name: project.name,
      partner: project.partner,
      status: project.status,
      linear_state: linearProject?.state?.name ?? undefined,
      linear_health: linearProject?.health || undefined,
      target_date: linearProject?.targetDate ?? undefined,
      latest_update: latestUpdateBody,
      open_follow_ups: projectFollowUps.slice(0, 5).map((f) => ({
        task: f.task,
        follow_up_by: f.follow_up_by ?? undefined,
      })),
      open_zendesk_threads: openThreads,
      primary_zendesk: primaryZendesk,
      open_linear_issues: trimmedIssues,
      p2_url: project.p2_url,
    });
  }

  // Hot/at-risk first, then active. Stable within each bucket on name.
  const statusOrder: Record<string, number> = {
    hot: 0,
    "at-risk": 1,
    active: 2,
  };
  slices.sort((a, b) => {
    const ao = statusOrder[a.status] ?? 99;
    const bo = statusOrder[b.status] ?? 99;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });

  const style = (await loadStyleReference()) ?? undefined;
  const context = await loadJobContext({
    operating_rhythm: true,
  });

  try {
    const result = await composeAfkNotes(runtime, {
      start_date: input.start_date,
      end_date: input.end_date,
      author_name: authorName,
      coverage_handle: input.coverage_handle.trim(),
      intro_notes: input.intro_notes?.trim() || undefined,
      projects: slices,
      style,
      context,
    });
    return { ok: true, data: result.output };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "Agent call failed",
    };
  }
}
