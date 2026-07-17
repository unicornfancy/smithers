import "server-only";

import type { SmithersConfig } from "./config";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * True when the given moment is inside the user's configured active
 * hours window AND on a workday. Called at the top of each periodic
 * scheduler job — if false, the job returns a "skipped" summary
 * without doing any work.
 *
 * When `active_hours` isn't configured, always returns true (legacy
 * behavior; scheduler jobs run on their own interval regardless of
 * time-of-day).
 *
 * Time-of-day comparison uses the user's `working_rhythm.timezone`
 * (Intl.DateTimeFormat), not the server's local time — so a
 * Smithers running on a laptop that's traveled to another TZ still
 * honors "9am Pacific" instead of "9am wherever the laptop woke up."
 *
 * A window that wraps midnight (`start > end`, e.g. 22:00–06:00) is
 * treated as inclusive on both halves — inside 22:00–23:59 or
 * 00:00–06:00. Katie's use case is 09:00–17:00 style, but let's be
 * correct.
 */
export function isWithinActiveHours(
  cfg: SmithersConfig,
  now: Date = new Date(),
): boolean {
  const rhythm = cfg.working_rhythm;
  const hours = rhythm.active_hours;
  if (!hours || !hours.start || !hours.end) return true;

  const timezone = rhythm.timezone || "America/Los_Angeles";
  const workdays = new Set(
    (rhythm.workdays ?? []).map((d) => d.toLowerCase()),
  );

  const parts = getTzParts(now, timezone);
  if (!parts) return true; // Intl failure — fail-open rather than starve the job.

  const dayKey = DAY_KEYS[parts.weekday];
  if (workdays.size > 0 && dayKey && !workdays.has(dayKey)) return false;

  const nowMin = parts.hour * 60 + parts.minute;
  const startMin = parseHhMm(hours.start);
  const endMin = parseHhMm(hours.end);
  if (startMin === null || endMin === null) return true;

  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // Wraps midnight — inside means past start OR before end.
  return nowMin >= startMin || nowMin < endMin;
}

interface TzParts {
  weekday: number; // 0 = Sun, 6 = Sat
  hour: number;
  minute: number;
}

function getTzParts(when: Date, timezone: string): TzParts | null {
  try {
    // `weekday: 'short'` gives 'Sun'..'Sat'; parse those. Time parts
    // come as 2-digit strings from `numeric: '2-digit'`.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(when);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const wd = (get("weekday") ?? "").toLowerCase().slice(0, 3);
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    const weekday = DAY_KEYS.findIndex((d) => d === wd);
    if (weekday < 0 || !Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null;
    }
    // Intl sometimes returns hour=24 at midnight in some locales.
    return {
      weekday,
      hour: hour === 24 ? 0 : hour,
      minute,
    };
  } catch {
    return null;
  }
}

function parseHhMm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
