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
import { getVault } from "@/lib/server/vault";

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

/**
 * Set `working_rhythm.active_hours.{start,end}` — the gate every
 * periodic scheduler job (ping monitor, sync trio, roster/charter/
 * zendesk syncs) checks before running. Empty strings clear the
 * window (all jobs run any time, legacy behavior).
 *
 * Daily briefing bypasses this gate — it fires at
 * `schedule.daily_briefing.time` regardless of active hours since
 * that's usually before the user is online by design.
 *
 * `workdays` isn't editable here (still tuned via config file);
 * jobs respect the existing `working_rhythm.workdays` set. On
 * Sat/Sun a job never fires even inside the window.
 */
export async function updateActiveHoursAction(input: {
  start?: string;
  end?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const start = input.start?.trim() ?? "";
    const end = input.end?.trim() ?? "";
    for (const [name, v] of [
      ["start", start],
      ["end", end],
    ] as const) {
      if (v && !/^\d{1,2}:\d{2}$/.test(v)) {
        return {
          ok: false,
          reason: `${name} must be HH:MM in 24-hour format or empty`,
        };
      }
    }
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const rhythmBlock = isObject(next["working_rhythm"])
      ? (next["working_rhythm"] as Record<string, unknown>)
      : {};
    if (start === "" && end === "") {
      delete rhythmBlock["active_hours"];
    } else {
      const activeBlock = isObject(rhythmBlock["active_hours"])
        ? (rhythmBlock["active_hours"] as Record<string, unknown>)
        : {};
      activeBlock["start"] = start;
      activeBlock["end"] = end;
      rhythmBlock["active_hours"] = activeBlock;
    }
    next["working_rhythm"] = rhythmBlock;
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

/**
 * Set the Kosh channel (`stable` / `trunk` / `pinned`) and, when
 * channel === "pinned", the specific tag to lock to. Update Kosh
 * card writes this then triggers a sync so HEAD moves to the new
 * target immediately.
 */
export async function updateKoshChannelAction(input: {
  channel: "stable" | "trunk" | "pinned";
  pinned_tag?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const validChannels = new Set(["stable", "trunk", "pinned"]);
    if (!validChannels.has(input.channel)) {
      return { ok: false, reason: "unknown channel" };
    }
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const block = isObject(next["kosh"])
      ? (next["kosh"] as Record<string, unknown>)
      : {};
    block["channel"] = input.channel;
    if (input.channel === "pinned") {
      const trimmed = input.pinned_tag?.trim();
      if (!trimmed) {
        return { ok: false, reason: "pinned_tag required for pinned channel" };
      }
      block["pinned_tag"] = trimmed;
    } else if ("pinned_tag" in block) {
      delete block["pinned_tag"];
    }
    next["kosh"] = block;
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

/**
 * Union of every partner slug currently referenced in the vault (from
 * `hive_mind_partner_slug` and slug-shaped `partner:` values) plus every
 * folder under Hive Mind's `knowledge/partners/`. Feeds the Rename
 * Partner card's "current slug" autocomplete so we don't ask users to
 * hand-type something they can typo.
 */
export async function listKnownPartnerSlugsAction(): Promise<{
  slugs: string[];
}> {
  try {
    const vault = await getVault();
    const projects = await vault.listProjects();
    const slugSet = new Set<string>();
    for (const p of projects) {
      const hm = p.hive_mind_partner_slug?.trim().toLowerCase();
      if (hm && /^[a-z0-9][a-z0-9-]*$/.test(hm)) slugSet.add(hm);
      const partner = p.partner?.trim().toLowerCase();
      if (partner && /^[a-z0-9][a-z0-9-]*$/.test(partner)) slugSet.add(partner);
    }
    const hmRoot = vault.options.hiveMindPath;
    if (hmRoot) {
      try {
        const { readdir } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const entries = await readdir(join(hmRoot, "knowledge", "partners"), {
          withFileTypes: true,
        });
        for (const e of entries) {
          if (e.isDirectory()) slugSet.add(e.name);
        }
      } catch {
        // HM path unset or partners dir missing; skip silently.
      }
    }
    return { slugs: Array.from(slugSet).sort() };
  } catch {
    return { slugs: [] };
  }
}

export async function renamePartnerSlugAction(input: {
  oldSlug?: string;
  newSlug?: string;
}): Promise<
  | {
      ok: true;
      data: {
        changed: boolean;
        projects_updated: Array<{ slug: string; name: string }>;
        projects_skipped: Array<{ slug: string; name: string; reason: string }>;
        dir_renamed: boolean;
        committed: boolean;
        commit_sha?: string;
      };
    }
  | { ok: false; reason: string; message: string }
> {
  const oldSlug = input.oldSlug?.trim() ?? "";
  const newSlug = input.newSlug?.trim() ?? "";
  if (!oldSlug || !newSlug) {
    return {
      ok: false,
      reason: "invalid-slug",
      message: "Both current and new slug are required.",
    };
  }
  try {
    const vault = await getVault();
    const result = await vault.renameHiveMindPartnerSlug({ oldSlug, newSlug });
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: result.message };
    }
    revalidatePath("/settings");
    revalidatePath("/projects");
    revalidatePath("/projects/[slug]", "page");
    revalidatePath("/today");
    return {
      ok: true,
      data: {
        changed: result.changed,
        projects_updated: result.projects_updated,
        projects_skipped: result.projects_skipped,
        dir_renamed: result.dir_renamed,
        committed: result.committed,
        commit_sha: result.commit_sha,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "rename failed",
    };
  }
}
