/**
 * Node-only side of the instrumentation hook.
 *
 * Loaded by `instrumentation.ts` when NEXT_RUNTIME === "nodejs", so
 * webpack only compiles its node:* imports for the Node runtime.
 *
 * Registers in-process background jobs when config opts in:
 *   - daily_briefing  → fires once per day at HH:MM (scheduleDaily)
 *   - ping_monitor    → fires every N minutes (scheduleInterval)
 *   - fathom_sync     → fires every N minutes
 *   - hive_mind_sync  → fires every N minutes
 *
 * Schedule changes via /settings require a dev-server restart to
 * take effect — timers are computed once on register.
 */

import { loadConfig } from "@/lib/server/config";
import { runDailyBriefing } from "@/lib/server/briefing";
import {
  runFathomSyncJob,
  runHiveMindSyncJob,
  runPingMonitorJob,
  runTeamRosterSyncJob,
  type JobResult,
} from "@/lib/server/scheduler-jobs";

let registered = false;

export async function setup(): Promise<void> {
  if (registered) return;
  registered = true;

  const cfg = await loadConfig();

  // --- Daily briefing (HH:MM, once per day) ---
  registerDailyBriefing(cfg);

  // --- Interval jobs (every N minutes) ---
  registerIntervalJob({
    label: "ping monitor",
    enabled: cfg.schedule?.ping_monitor?.enabled,
    intervalMinutes: cfg.schedule?.ping_monitor?.interval_minutes ?? 15,
    run: runPingMonitorJob,
  });
  registerIntervalJob({
    label: "fathom sync",
    enabled: cfg.schedule?.fathom_sync?.enabled,
    intervalMinutes: cfg.schedule?.fathom_sync?.interval_minutes ?? 60,
    run: runFathomSyncJob,
  });
  registerIntervalJob({
    label: "hive mind sync",
    enabled: cfg.schedule?.hive_mind_sync?.enabled,
    intervalMinutes: cfg.schedule?.hive_mind_sync?.interval_minutes ?? 30,
    run: runHiveMindSyncJob,
  });
  registerIntervalJob({
    label: "team roster sync",
    enabled: cfg.schedule?.team_roster_sync?.enabled,
    intervalMinutes:
      cfg.schedule?.team_roster_sync?.interval_minutes ?? 7 * 24 * 60,
    run: runTeamRosterSyncJob,
  });
}

function registerDailyBriefing(
  cfg: Awaited<ReturnType<typeof loadConfig>>,
): void {
  const briefing = cfg.schedule?.daily_briefing;
  if (!briefing?.enabled) {
    console.log("[scheduler] daily briefing disabled — skipping registration");
    return;
  }
  const time = briefing.time ?? cfg.working_rhythm.briefing_time ?? "07:30";
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    console.warn(`[scheduler] invalid briefing time "${time}" — expected HH:MM`);
    return;
  }
  const hh = parseInt(match[1]!, 10);
  const mm = parseInt(match[2]!, 10);
  if (hh > 23 || mm > 59) {
    console.warn(`[scheduler] out-of-range briefing time "${time}"`);
    return;
  }

  scheduleDaily(hh, mm, async () => {
    const startedAt = new Date().toISOString();
    console.log(`[scheduler] daily briefing firing at ${startedAt}`);
    try {
      const result = await runDailyBriefing();
      console.log(
        `[scheduler] daily briefing done top_three=${result.top_three.ok} realistic_shape=${result.realistic_shape.ok}`,
      );
    } catch (err) {
      console.error(`[scheduler] daily briefing failed:`, err);
    }
  });
  console.log(`[scheduler] daily briefing registered for ${time} local time`);
}

function registerIntervalJob(opts: {
  label: string;
  enabled: boolean | undefined;
  intervalMinutes: number;
  run: () => Promise<JobResult>;
}): void {
  if (!opts.enabled) {
    console.log(`[scheduler] ${opts.label} disabled — skipping registration`);
    return;
  }
  if (!Number.isFinite(opts.intervalMinutes) || opts.intervalMinutes < 1) {
    console.warn(
      `[scheduler] ${opts.label} invalid interval ${opts.intervalMinutes} — skipping`,
    );
    return;
  }
  const intervalMs = Math.round(opts.intervalMinutes * 60 * 1000);
  scheduleInterval(intervalMs, async () => {
    try {
      const result = await opts.run();
      if (result.ok) {
        console.log(
          `[scheduler] ${opts.label} ok · ${result.summary ?? ""} · ${result.duration_ms}ms`,
        );
      } else {
        console.warn(
          `[scheduler] ${opts.label} failed · ${result.error ?? ""} · ${result.duration_ms}ms`,
        );
      }
    } catch (err) {
      console.error(`[scheduler] ${opts.label} threw:`, err);
    }
  });
  console.log(
    `[scheduler] ${opts.label} registered for every ${opts.intervalMinutes} min`,
  );
}

/**
 * Fire `job` once per local day at the given hour/minute. Computes
 * the next fire time, waits with setTimeout, runs the job, then
 * recursively schedules the next day. Survives DST shifts because
 * each iteration recomputes against the wall clock.
 *
 * Why hand-rolled: node-cron's ESM build imports `node:crypto` in a
 * way that trips webpack's bundling even with serverExternalPackages.
 * "Daily at HH:MM" is trivial enough to compute manually.
 */
function scheduleDaily(
  hour: number,
  minute: number,
  job: () => Promise<void> | void,
): void {
  function fireAndRescheduleNext() {
    void Promise.resolve(job()).finally(() => queueNext());
  }
  function queueNext() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    const delay = target.getTime() - now.getTime();
    setTimeout(fireAndRescheduleNext, delay);
  }
  queueNext();
}

/**
 * Fire `job` every `intervalMs` milliseconds. Uses setTimeout chain
 * rather than setInterval so an overrunning job doesn't pile up;
 * the next fire is queued only after the current one settles.
 */
function scheduleInterval(
  intervalMs: number,
  job: () => Promise<void> | void,
): void {
  function fireAndRescheduleNext() {
    void Promise.resolve(job()).finally(() => {
      setTimeout(fireAndRescheduleNext, intervalMs);
    });
  }
  // Initial tick after one interval — don't fire immediately on boot.
  setTimeout(fireAndRescheduleNext, intervalMs);
}

// Auto-run on import so instrumentation.ts can just `await import(...)`.
void setup();
