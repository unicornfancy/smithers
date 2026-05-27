import "server-only";

/**
 * In-process daily briefing job.
 *
 * Pre-warms the Top 3 + Realistic Shape generation so /today renders
 * instantly when the user opens it in the morning. Triggered by the
 * cron registered in `instrumentation.ts`, or manually via the
 * /api/agents/briefing POST endpoint (also used by the optional
 * launchd plist).
 *
 * Internally fans out to the same /api/agents/top-three and
 * /api/agents/realistic-shape routes that /today uses — no logic
 * duplication, and a single source of truth for caching + writeback.
 */

const DEFAULT_HOST = "http://localhost:3000";

export interface BriefingResult {
  top_three: { ok: boolean; status?: number; cached?: boolean; error?: string };
  realistic_shape: { ok: boolean; status?: number; cached?: boolean; error?: string };
  started_at: string;
  finished_at: string;
}

export async function runDailyBriefing(opts?: {
  /** Override the host. Defaults to SMITHERS_INTERNAL_URL env var, then http://localhost:3000. */
  host?: string;
  /** Force a fresh run even when the day's cache is already populated. Defaults to true (the whole point of the cron is fresh output). */
  force?: boolean;
}): Promise<BriefingResult> {
  const host =
    opts?.host ?? process.env["SMITHERS_INTERNAL_URL"] ?? DEFAULT_HOST;
  const force = opts?.force ?? true;
  const qs = force ? "?force=true" : "";

  const started_at = new Date().toISOString();
  const [topThree, realisticShape] = await Promise.all([
    callRoute(`${host}/api/agents/top-three${qs}`),
    callRoute(`${host}/api/agents/realistic-shape${qs}`),
  ]);
  const finished_at = new Date().toISOString();
  return { top_three: topThree, realistic_shape: realisticShape, started_at, finished_at };
}

async function callRoute(
  url: string,
): Promise<{ ok: boolean; status?: number; cached?: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      cached?: boolean;
      error?: string;
    };
    return {
      ok: res.ok && body.ok !== false,
      status: res.status,
      cached: body.cached,
      error: body.error,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
