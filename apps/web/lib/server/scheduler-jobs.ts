import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { loadConfig } from "@/lib/server/config";
import { getMcpClient } from "@/lib/server/mcp";
import { recomputeActioned } from "@/lib/server/ping-actioned";
import { getTranscriptionAdapter } from "@/lib/server/transcription";

/**
 * Background job runners shared by `/api/jobs/<name>` (manual + launchd)
 * and the in-process scheduler in `instrumentation-node.ts`.
 *
 * Each helper returns a discriminated-union-friendly result the API
 * route + Run-Now button surface verbatim. Errors are caught and
 * downgraded to `{ ok: false, error }` — never thrown — so a flaky
 * MCP doesn't kill the cron.
 */

const execFileAsync = promisify(execFile);

export interface JobResult {
  ok: boolean;
  /** Free-form per-job summary (e.g. "checked 7 pings, 3 actioned"). */
  summary?: string;
  error?: string;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Ping monitor — re-runs the "did Katie reply?" detector against the current
// Pings to Action list and writes verdicts to the ping_actioned cache.
// ---------------------------------------------------------------------------

export async function runPingMonitorJob(): Promise<JobResult> {
  const started = Date.now();
  try {
    const mcp = await getMcpClient();
    const pingsResult = await mcp.contextA8C.listPings({ limit: 25 });
    const pings = pingsResult.ok
      ? pingsResult.data
      : (pingsResult.cachedData ?? []);
    if (pings.length === 0) {
      return { ok: true, summary: "no pings to check", duration_ms: Date.now() - started };
    }
    const result = await recomputeActioned(
      pings.map((p) => ({
        id: p.id,
        source: p.source,
        url: p.url,
        timestamp: p.timestamp,
      })),
    );
    return {
      ok: true,
      summary: `checked ${result.checked}, ${result.actioned} actioned`,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - started,
    };
  }
}

// ---------------------------------------------------------------------------
// Transcription sync — warms the configured provider's recordings cache so
// /calls + /today's Recent Calls surface new meetings without a
// user-triggered fetch. Originally called "Fathom sync" — renamed
// 2026-06-09 to reflect that the underlying provider is pluggable.
// ---------------------------------------------------------------------------

export async function runTranscriptionSyncJob(): Promise<JobResult> {
  const started = Date.now();
  try {
    const transcription = await getTranscriptionAdapter();
    const result = await transcription.listRecordings({ limit: 50 });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error.message ?? "listRecordings failed",
        duration_ms: Date.now() - started,
      };
    }
    return {
      ok: true,
      summary: `fetched ${result.data.length} recording(s) via ${transcription.provider}`,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - started,
    };
  }
}

// ---------------------------------------------------------------------------
// Hive Mind sync — `git pull` + `git push` on the configured Hive Mind clone
// so collaborative edits from other TAMs land without manual git work AND
// Smithers-generated commits (Process Call, brief generation, etc.) get
// shared with the team automatically. Skips on a dirty working tree.
// ---------------------------------------------------------------------------

export async function runHiveMindSyncJob(): Promise<JobResult> {
  const started = Date.now();
  try {
    const cfg = await loadConfig();
    const hmPath = cfg.paths.hive_mind;
    if (!hmPath || !existsSync(hmPath)) {
      return {
        ok: false,
        error: `hive_mind path not configured or missing: ${hmPath || "(unset)"}`,
        duration_ms: Date.now() - started,
      };
    }

    // Bail on a dirty tree — porcelain returns non-empty when there are
    // uncommitted/untracked changes. We log it as a soft warning rather
    // than a hard failure since the job will simply retry next tick.
    const { stdout: status } = await execFileAsync("git", [
      "-C",
      hmPath,
      "status",
      "--porcelain",
    ]);
    if (status.trim().length > 0) {
      return {
        ok: true,
        summary: "skipped (dirty working tree)",
        duration_ms: Date.now() - started,
      };
    }

    // Always fetch first so we know exactly how many commits are pending
    // in each direction. Pull/push decisions depend on it.
    await execFileAsync("git", ["-C", hmPath, "fetch"]);
    const { stdout: aheadBehindRaw } = await execFileAsync("git", [
      "-C",
      hmPath,
      "rev-list",
      "--count",
      "--left-right",
      "@{u}...HEAD",
    ]);
    const [behindStr, aheadStr] = aheadBehindRaw.trim().split(/\s+/);
    const behind = parseInt(behindStr ?? "0", 10);
    const ahead = parseInt(aheadStr ?? "0", 10);

    let pullSummary = "";
    let pushSummary = "";

    if (behind > 0 && ahead === 0) {
      // Pure fast-forward pull.
      const { stdout, stderr } = await execFileAsync("git", [
        "-C",
        hmPath,
        "pull",
        "--ff-only",
      ]);
      pullSummary = firstLine(`${stdout}\n${stderr}`);
    } else if (behind > 0 && ahead > 0) {
      // Diverged — rebase the local-ahead commits onto the new remote
      // before push. `--ff-only` would fail in this state.
      const { stdout, stderr } = await execFileAsync("git", [
        "-C",
        hmPath,
        "pull",
        "--rebase",
      ]);
      pullSummary = `rebased ${ahead} local commit(s) onto ${behind} new remote: ${firstLine(`${stdout}\n${stderr}`)}`;
    }

    // Recheck ahead-count after the pull because rebase may have
    // re-set local commits with new SHAs but kept them ahead.
    if (ahead > 0 || behind === 0) {
      const { stdout: aheadAfterRaw } = await execFileAsync("git", [
        "-C",
        hmPath,
        "rev-list",
        "--count",
        "@{u}..HEAD",
      ]);
      const aheadAfter = parseInt(aheadAfterRaw.trim(), 10);
      if (aheadAfter > 0) {
        const { stdout, stderr } = await execFileAsync("git", [
          "-C",
          hmPath,
          "push",
        ]);
        pushSummary = `pushed ${aheadAfter} local commit(s): ${firstLine(`${stdout}\n${stderr}`)}`;
      }
    }

    if (!pullSummary && !pushSummary) {
      return {
        ok: true,
        summary: "already up to date",
        duration_ms: Date.now() - started,
      };
    }
    return {
      ok: true,
      summary: [pullSummary, pushSummary].filter(Boolean).join(" · ").slice(0, 200),
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - started,
    };
  }
}

function firstLine(s: string): string {
  return s.trim().split("\n")[0]?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Team roster sync — refreshes the auto-managed block in JOB_CONTEXT.md's
// Common collaborators section from the configured Matticspace group.
// ---------------------------------------------------------------------------

export async function runTeamRosterSyncJob(): Promise<JobResult> {
  const started = Date.now();
  try {
    const cfg = await loadConfig();
    const groupSlugs =
      cfg.schedule?.team_roster_sync?.group_slugs ?? ["team-51"];
    const { syncTeamRostersToJobContext } = await import(
      "@/lib/server/team-roster"
    );
    const result = await syncTeamRostersToJobContext({
      groupSlugs,
      includeSubteams: true,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error ?? "team roster sync failed",
        duration_ms: Date.now() - started,
      };
    }
    const perGroup = (result.groups ?? [])
      .map((g) => `${g.slug}=${g.members}${g.changed ? "*" : ""}`)
      .join(" ");
    return {
      ok: true,
      summary: `${result.members_synced} members synced (${perGroup}${result.changed ? "" : "; no change"})`,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - started,
    };
  }
}

// ---------------------------------------------------------------------------
// Team charter sync — pulls the configured Google Sheet tab via the Drive
// client and rewrites the auto-managed block in `my-voice/TEAM_CHARTER.md`.
// ---------------------------------------------------------------------------

export async function runTeamCharterSyncJob(): Promise<JobResult> {
  const started = Date.now();
  try {
    const cfg = await loadConfig();
    const sheetUrl = cfg.schedule?.team_charter_sync?.sheet_url?.trim();
    if (!sheetUrl) {
      return {
        ok: false,
        error: "team charter sync enabled but schedule.team_charter_sync.sheet_url is empty",
        duration_ms: Date.now() - started,
      };
    }
    const { syncTeamCharter } = await import("@/lib/server/team-charter");
    const result = await syncTeamCharter({ sheet_url: sheetUrl });
    return {
      ok: true,
      summary: `${result.rows} rows synced${result.changed ? "" : "; no change"}`,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - started,
    };
  }
}

// ---------------------------------------------------------------------------
// Zendesk status sync — re-poll Zendesk for every attached ticket's
// status / subject / priority / updated_at and write the fresh values
// into project frontmatter. Keeps the /today "Waiting on you" card from
// surfacing tickets that have since been closed by someone else.
// ---------------------------------------------------------------------------

export async function runZendeskStatusSyncJob(): Promise<JobResult> {
  const started = Date.now();
  try {
    const { getVault } = await import("@/lib/server/vault");
    const { refreshZendeskMetadataAction } = await import(
      "@/app/projects/[slug]/actions"
    );
    const vault = await getVault();
    const projects = await vault.listProjects().catch(() => []);

    // Only projects with attached tickets are worth polling. Skip
    // personal projects entirely — Zendesk is partner / team only.
    const candidates = projects.filter(
      (p) =>
        (p.kind === "partner" || p.kind === "team") &&
        (p.zendesk_tickets ?? []).length > 0,
    );

    let totalUpdated = 0;
    let totalChecked = 0;
    let projectsTouched = 0;

    // Fan out per project. Each call does its own search fan-out
    // internally + frontmatter write; failures degrade per-project
    // rather than killing the whole job.
    await Promise.all(
      candidates.map(async (p) => {
        const hints = [p.partner ?? "", p.partner?.replace(/-/g, " ") ?? "", p.name]
          .map((s) => s.trim())
          .filter(Boolean);
        const r = await refreshZendeskMetadataAction(p.slug, hints).catch(
          () => null,
        );
        if (!r) return;
        totalChecked += r.total;
        totalUpdated += r.updated;
        if (r.updated > 0) projectsTouched += 1;
      }),
    );

    return {
      ok: true,
      summary: `${totalUpdated}/${totalChecked} tickets updated across ${projectsTouched}/${candidates.length} project(s)`,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - started,
    };
  }
}
