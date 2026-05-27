/**
 * Node-only side of the instrumentation hook.
 *
 * Loaded by `instrumentation.ts` when NEXT_RUNTIME === "nodejs", so
 * webpack only compiles its node:* imports for the Node runtime.
 *
 * Registers the in-process daily-briefing pre-warm when config opts
 * in. Schedule changes via /settings require a dev-server restart to
 * take effect (the timer is computed once on register).
 */

import { loadConfig } from "@/lib/server/config";
import { runDailyBriefing } from "@/lib/server/briefing";

let registered = false;

export async function setup(): Promise<void> {
  if (registered) return;
  registered = true;

  const cfg = await loadConfig();
  const briefing = cfg.schedule?.daily_briefing;
  if (!briefing?.enabled) {
    console.log("[scheduler] daily briefing disabled — skipping registration");
    return;
  }

  const time = briefing.time ?? cfg.working_rhythm.briefing_time ?? "07:30";
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    console.warn(
      `[scheduler] invalid briefing time "${time}" — expected HH:MM`,
    );
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

// Auto-run on import so instrumentation.ts can just `await import(...)`.
void setup();
