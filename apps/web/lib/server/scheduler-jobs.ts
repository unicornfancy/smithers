import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { loadConfig } from "@/lib/server/config";
import { getMcpClient } from "@/lib/server/mcp";
import { recomputeActioned } from "@/lib/server/ping-actioned";

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
// Fathom sync — warms the recordings cache so /calls + /today's Recent Calls
// surface new meetings without a user-triggered fetch.
// ---------------------------------------------------------------------------

export async function runFathomSyncJob(): Promise<JobResult> {
  const started = Date.now();
  try {
    const mcp = await getMcpClient();
    const result = await mcp.fathom.listRecordings({ limit: 50 });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error.message ?? "fathom listRecordings failed",
        duration_ms: Date.now() - started,
      };
    }
    return {
      ok: true,
      summary: `fetched ${result.data.length} recording(s)`,
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
// Hive Mind sync — `git pull` on the configured Hive Mind clone so
// collaborative edits from other TAMs land without manual git work.
// Skips on a dirty working tree (would otherwise need to fight conflicts).
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

    const { stdout: pullOut, stderr: pullErr } = await execFileAsync("git", [
      "-C",
      hmPath,
      "pull",
      "--ff-only",
    ]);
    const combined = `${pullOut}\n${pullErr}`.trim();
    const upToDate = /already up.to.date/i.test(combined);
    return {
      ok: true,
      summary: upToDate
        ? "already up to date"
        : combined.split("\n").slice(0, 2).join(" / ").slice(0, 200),
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
