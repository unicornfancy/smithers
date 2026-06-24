"use server";

import { revalidatePath } from "next/cache";

import {
  configLocalPath,
  isObject,
  readYamlFile,
  writeYamlAtomic,
} from "@/lib/server/config-write";
import { clearCachedFor } from "@/lib/server/llm-cache";
import {
  clearAction,
  type ActionKind,
  type EntityType,
} from "@/lib/server/user-actions";

/**
 * Undo a previously-recorded user action. The Activity Log is the
 * single audit + recovery surface for everything Smithers has been
 * told to do — pin / demote / dismiss / accept all flow through here.
 *
 * Mirrors the cache-invalidation logic from /today's mutating actions:
 * undoing anything Top-3-relevant clears both LLM caches so the next
 * /today render reflects the restored candidate set.
 */
export async function undoActionEntry(
  entityType: EntityType,
  entityId: string,
  action: ActionKind,
): Promise<void> {
  if (!entityType || !entityId || !action) {
    throw new Error("entityType, entityId, and action are all required");
  }
  await clearAction(entityType, entityId, action);

  // Almost any undo can change Top 3 / Realistic Shape: dismissing a
  // ping pulled it from candidates; pinning bumped one to the top;
  // accepting a stall removed a follow-up. Cheaper to invalidate both
  // caches than to reason about which ones are actually stale.
  await Promise.all([
    clearCachedFor("top-3"),
    clearCachedFor("realistic-shape"),
  ]);

  revalidatePath("/today");
  revalidatePath("/settings");
  revalidatePath("/projects/[slug]", "page");
}

/**
 * Patch `weekly_update.format_template` in config.local.yaml. Pass an
 * empty string to clear the override (back to the agent's built-in
 * default). The template is free-form prose handed to the agent at
 * generate time — it can include the 3 starter presets verbatim or
 * any custom format.
 */
/**
 * Patch `agents.analyze_call_transcript_prompt`. Empty string clears
 * back to the bundled default. Used by the Process Call flow's global
 * system-prompt override.
 */
export async function updateAnalyzeCallTranscriptPromptAction(
  prompt: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const block = isObject(next["agents"])
      ? (next["agents"] as Record<string, unknown>)
      : {};
    const trimmed = prompt.trim();
    if (trimmed === "") {
      delete block["analyze_call_transcript_prompt"];
    } else {
      block["analyze_call_transcript_prompt"] = trimmed;
    }
    if (Object.keys(block).length > 0) {
      next["agents"] = block;
    } else {
      delete next["agents"];
    }
    await writeYamlAtomic(path, next);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "write failed",
    };
  }
}

/**
 * Patch `stall_thresholds.*` and `follow_ups.default_window_days`. Any
 * field omitted from the input is left alone; numbers are coerced and
 * basic range checks reject negatives.
 */
export async function updateFollowUpAutomationAction(input: {
  follow_up_nudge_days?: number;
  follow_up_escalate_days?: number;
  follow_up_force_decide_days?: number;
  next_nudge_lookahead_days?: number;
  default_window_days?: number;
  /** /today Deadlines card lookahead in days. Lives at today.deadlines_window_days. */
  today_deadlines_window_days?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const stallBlock = isObject(next["stall_thresholds"])
      ? (next["stall_thresholds"] as Record<string, unknown>)
      : {};
    const followBlock = isObject(next["follow_ups"])
      ? (next["follow_ups"] as Record<string, unknown>)
      : {};
    for (const key of [
      "follow_up_nudge_days",
      "follow_up_escalate_days",
      "follow_up_force_decide_days",
      "next_nudge_lookahead_days",
    ] as const) {
      const v = input[key];
      if (v === undefined) continue;
      if (!Number.isFinite(v) || v < 0) {
        return { ok: false, reason: `${key} must be a non-negative number` };
      }
      stallBlock[key] = Math.round(v);
    }
    if (input.default_window_days !== undefined) {
      if (
        !Number.isFinite(input.default_window_days) ||
        input.default_window_days < 0
      ) {
        return { ok: false, reason: "default_window_days must be non-negative" };
      }
      followBlock["default_window_days"] = Math.round(input.default_window_days);
    }
    const todayBlock = isObject(next["today"])
      ? (next["today"] as Record<string, unknown>)
      : {};
    if (input.today_deadlines_window_days !== undefined) {
      if (
        !Number.isFinite(input.today_deadlines_window_days) ||
        input.today_deadlines_window_days < 1
      ) {
        return {
          ok: false,
          reason: "today_deadlines_window_days must be at least 1",
        };
      }
      todayBlock["deadlines_window_days"] = Math.round(
        input.today_deadlines_window_days,
      );
    }
    if (Object.keys(stallBlock).length > 0) next["stall_thresholds"] = stallBlock;
    if (Object.keys(followBlock).length > 0) next["follow_ups"] = followBlock;
    if (Object.keys(todayBlock).length > 0) next["today"] = todayBlock;
    await writeYamlAtomic(path, next);
    revalidatePath("/settings");
    revalidatePath("/today");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "write failed",
    };
  }
}

/**
 * Patch `schedule.daily_briefing.{enabled, time}`. The instrumentation
 * hook re-reads config on each cron fire, so changes take effect on
 * the next scheduled tick (or restart the dev server to reset the
 * cron registration).
 */
/**
 * Patch one of the interval-based background jobs in
 * `schedule.{ping_monitor,transcription_sync,hive_mind_sync,team_roster_sync}.
 * {enabled, interval_minutes}`. Schedule changes require a dev-server
 * restart to register the new timer.
 *
 * `fathom_sync` is accepted as a legacy alias for `transcription_sync`
 * — the loader already prefers the new key when both are present, and
 * we don't migrate the old block on the fly to keep this action a pure
 * write. Pass the new name from any new caller.
 */
export async function updateIntervalJobAction(input: {
  job:
    | "ping_monitor"
    | "transcription_sync"
    | "hive_mind_sync"
    | "team_roster_sync"
    | "team_charter_sync"
    | "zendesk_status_sync"
    | "fathom_sync";
  enabled?: boolean;
  interval_minutes?: number;
  /** Only meaningful for team_charter_sync. Persisted at schedule.team_charter_sync.sheet_url. */
  sheet_url?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const scheduleBlock = isObject(next["schedule"])
      ? (next["schedule"] as Record<string, unknown>)
      : {};
    // Auto-migrate fathom_sync writes to the canonical name.
    const targetKey = input.job === "fathom_sync" ? "transcription_sync" : input.job;
    const jobBlock = isObject(scheduleBlock[targetKey])
      ? (scheduleBlock[targetKey] as Record<string, unknown>)
      : {};
    if (input.enabled !== undefined) {
      jobBlock["enabled"] = Boolean(input.enabled);
    }
    if (input.interval_minutes !== undefined) {
      const n = Number(input.interval_minutes);
      if (!Number.isFinite(n) || n < 1) {
        return { ok: false, reason: "interval_minutes must be >= 1" };
      }
      jobBlock["interval_minutes"] = Math.round(n);
    }
    if (input.sheet_url !== undefined && targetKey === "team_charter_sync") {
      const trimmed = input.sheet_url.trim();
      if (trimmed === "") {
        delete jobBlock["sheet_url"];
      } else {
        jobBlock["sheet_url"] = trimmed;
      }
    }
    scheduleBlock[targetKey] = jobBlock;
    // If the caller passed the legacy fathom_sync name, also clear the
    // old block so we don't end up with both keys diverging on disk.
    if (input.job === "fathom_sync") {
      delete scheduleBlock["fathom_sync"];
    }
    next["schedule"] = scheduleBlock;
    await writeYamlAtomic(path, next);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "write failed",
    };
  }
}

export async function updateScheduleAction(input: {
  daily_briefing_enabled?: boolean;
  daily_briefing_time?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const scheduleBlock = isObject(next["schedule"])
      ? (next["schedule"] as Record<string, unknown>)
      : {};
    const briefingBlock = isObject(scheduleBlock["daily_briefing"])
      ? (scheduleBlock["daily_briefing"] as Record<string, unknown>)
      : {};
    if (input.daily_briefing_enabled !== undefined) {
      briefingBlock["enabled"] = Boolean(input.daily_briefing_enabled);
    }
    if (input.daily_briefing_time !== undefined) {
      const t = input.daily_briefing_time.trim();
      if (t === "") {
        delete briefingBlock["time"];
      } else if (!/^\d{2}:\d{2}$/.test(t)) {
        return { ok: false, reason: "time must be HH:MM in 24-hour format" };
      } else {
        briefingBlock["time"] = t;
      }
    }
    scheduleBlock["daily_briefing"] = briefingBlock;
    next["schedule"] = scheduleBlock;
    await writeYamlAtomic(path, next);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "write failed",
    };
  }
}

const TRANSCRIPTION_PROVIDERS = [
  "fathom",
  "granola",
  "gemini",
  "manual",
  "whisper",
] as const;

type TranscriptionProvider = (typeof TRANSCRIPTION_PROVIDERS)[number];

export async function updateTranscriptionProviderAction(input: {
  provider: TranscriptionProvider;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    if (!TRANSCRIPTION_PROVIDERS.includes(input.provider)) {
      return { ok: false, reason: "unknown provider" };
    }
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const block = isObject(next["transcription"])
      ? (next["transcription"] as Record<string, unknown>)
      : {};
    block["provider"] = input.provider;
    next["transcription"] = block;
    await writeYamlAtomic(path, next);
    revalidatePath("/settings");
    revalidatePath("/calls");
    revalidatePath("/today");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "write failed",
    };
  }
}

export async function updateWeeklyUpdateFormatAction(
  template: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const block = isObject(next["weekly_update"])
      ? (next["weekly_update"] as Record<string, unknown>)
      : {};
    const trimmed = template.trim();
    if (trimmed === "") {
      delete block["format_template"];
    } else {
      block["format_template"] = trimmed;
    }
    if (Object.keys(block).length > 0) {
      next["weekly_update"] = block;
    } else {
      delete next["weekly_update"];
    }
    await writeYamlAtomic(path, next);
    revalidatePath("/settings");
    revalidatePath("/weekly-updates/[isoWeek]", "page");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "write failed",
    };
  }
}
