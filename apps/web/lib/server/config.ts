import "server-only";

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import yaml from "js-yaml";

/**
 * The full Smithers config shape, as it lives in `config.yaml` at the repo root.
 * Most fields are optional with sensible defaults; the wizard fills in the rest.
 */
export interface SmithersConfig {
  identity: {
    name: string;
    /**
     * The user's primary work email. Used to filter self-authored
     * notifications out of Pings to Action — e.g. Linear inbox sends
     * "you posted an update" / "you changed status" notifications
     * which shouldn't surface as inbound pings.
     */
    email?: string;
    github_handle?: string;
    slack_handle?: string;
    internal_email_domains: string[];
  };
  paths: {
    vault: string;
    hive_mind: string;
    data: string;
    my_voice?: string;
  };
  mcps: {
    context_a8c: { enabled: boolean; endpoint?: string };
    hive_mind: { enabled: boolean; endpoint?: string };
    fathom: { enabled: boolean; endpoint?: string };
  };
  agents: {
    api_key_env: string;
    model: string;
    effort: "low" | "medium" | "high" | "xhigh" | "max";
    /**
     * Optional override for the analyze-call-transcript agent's system
     * prompt. When set, replaces the bundled default. Edited via /settings.
     * Empty / unset = use the bundled default.
     */
    analyze_call_transcript_prompt?: string;
  };
  transcription: {
    provider: "fathom" | "granola" | "manual" | "whisper" | "gemini";
  };
  p2: {
    team_p2_url?: string;
    smithers_p2_post_url?: string;
    team_weekly_post_finder?: {
      /** Substituted with the ISO week number — e.g. "Week {n}" → "Week 19". */
      title_patterns?: string[];
      fallback?: "ask" | "newest" | "none";
    };
  };
  weekly_update?: {
    /** Free-form template instructions handed to the agent. Empty = use default per-project list. */
    format_template?: string;
  };
  working_rhythm: {
    timezone: string;
    workdays: string[];
    briefing_time: string;
  };
  stall_thresholds: {
    follow_up_nudge_days: number;
    follow_up_escalate_days: number;
    follow_up_force_decide_days: number;
    /** Days before a project's `next_nudge` date to surface a reminder. */
    next_nudge_lookahead_days: number;
  };
  follow_ups?: {
    /**
     * Default lookahead window when converting a To-do into a Follow-up:
     * "+N days" from today seeds the `follow_up_by` field. Surfaces in the
     * conversion modal as the pre-filled value.
     */
    default_window_days?: number;
  };
  schedule?: {
    /**
     * In-process daily briefing job: pre-warms the Top 3 / Realistic
     * Shape generation so /today opens with fresh cached output.
     */
    daily_briefing?: {
      enabled: boolean;
      /** HH:MM in 24-hour, local time. Defaults to working_rhythm.briefing_time. */
      time?: string;
    };
    /**
     * Ping monitor: re-runs the "did Katie already reply?" detector
     * against the current Pings to Action feed and writes verdicts to
     * the ping_actioned cache. Replaces the manual Refresh button on
     * /today when enabled.
     */
    ping_monitor?: {
      enabled: boolean;
      /** Minutes between fires. */
      interval_minutes?: number;
    };
    /**
     * Fathom sync: warms the Fathom recordings cache so /calls + Recent
     * Calls on /today show new meetings without opening the page.
     */
    fathom_sync?: {
      enabled: boolean;
      interval_minutes?: number;
    };
    /**
     * Hive Mind sync: `git pull` against the Hive Mind clone so
     * collaborative edits from other TAMs land without manual git work.
     * Skips on a dirty working tree (logs + returns rather than fighting
     * conflicts).
     */
    hive_mind_sync?: {
      enabled: boolean;
      interval_minutes?: number;
    };
    /**
     * Team roster sync: re-fetches the configured Matticspace group's
     * members and rewrites the auto-managed block in JOB_CONTEXT.md's
     * Common collaborators section. Default cadence weekly.
     */
    team_roster_sync?: {
      enabled: boolean;
      interval_minutes?: number;
      /** Matticspace group slug (default: "team-51"). */
      group_slug?: string;
    };
  };
}

const DEFAULTS: SmithersConfig = {
  identity: {
    name: "",
    internal_email_domains: ["automattic.com"],
  },
  paths: {
    vault: "~/Documents/A8C Claude",
    hive_mind: "~/Team51-Hive-Mind",
    data: "~/.smithers",
    my_voice: "",
  },
  mcps: {
    context_a8c: { enabled: false },
    hive_mind: { enabled: false },
    fathom: { enabled: false },
  },
  agents: {
    api_key_env: "ANTHROPIC_API_KEY",
    model: "claude-opus-4-7",
    effort: "high",
  },
  transcription: { provider: "manual" },
  p2: {},
  working_rhythm: {
    timezone: "America/Los_Angeles",
    workdays: ["mon", "tue", "wed", "thu", "fri"],
    briefing_time: "07:30",
  },
  stall_thresholds: {
    follow_up_nudge_days: 10,
    follow_up_escalate_days: 21,
    follow_up_force_decide_days: 30,
    next_nudge_lookahead_days: 14,
  },
  follow_ups: {
    default_window_days: 7,
  },
  schedule: {
    daily_briefing: { enabled: false },
    ping_monitor: { enabled: false, interval_minutes: 15 },
    fathom_sync: { enabled: false, interval_minutes: 60 },
    hive_mind_sync: { enabled: false, interval_minutes: 30 },
    team_roster_sync: {
      enabled: false,
      interval_minutes: 7 * 24 * 60,
      group_slug: "team-51",
    },
  },
};

let cached: SmithersConfig | null = null;

/**
 * Load `config.yaml` from the repo root. Falls back to `config.example.yaml`
 * for first-run / pre-setup, and to hardcoded defaults if neither exists.
 *
 * Cached after first read; restart the dev server to pick up edits during
 * development.
 */
export async function loadConfig(): Promise<SmithersConfig> {
  if (cached) return cached;

  const repoRoot = findRepoRoot();
  const candidates = [
    join(repoRoot, "config.yaml"),
    join(repoRoot, "config.local.yaml"),
    join(repoRoot, "config.example.yaml"),
  ];

  for (const path of candidates) {
    try {
      const raw = await readFile(path, "utf-8");
      const parsed = yaml.load(raw) as Partial<SmithersConfig> | null;
      cached = resolvePaths(mergeWithDefaults(parsed ?? {}), repoRoot);
      return cached;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }

  cached = resolvePaths(DEFAULTS, repoRoot);
  return cached;
}

/** Resolve a config path that may use `~` to an absolute path. */
export function expandConfigPath(p: string): string {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

// --- internals ---

function findRepoRoot(): string {
  // apps/web → repo root is two up.
  return resolve(process.cwd(), "..", "..");
}

/**
 * Expand all user-facing path strings:
 *   - `~`-prefixed → home directory
 *   - relative → resolved against the repo root (so `./templates/seed-data/vault`
 *     works regardless of where the dev server's cwd is)
 *   - absolute → unchanged
 */
function resolvePaths(
  cfg: SmithersConfig,
  repoRoot: string,
): SmithersConfig {
  return {
    ...cfg,
    paths: {
      vault: resolveOne(cfg.paths.vault, repoRoot),
      hive_mind: resolveOne(cfg.paths.hive_mind, repoRoot),
      data: resolveOne(cfg.paths.data, repoRoot),
      my_voice: cfg.paths.my_voice
        ? resolveOne(cfg.paths.my_voice, repoRoot)
        : "",
    },
  };
}

function resolveOne(p: string, repoRoot: string): string {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  if (p.startsWith(".")) return resolve(repoRoot, p);
  return resolve(p);
}

function mergeWithDefaults(
  partial: Partial<SmithersConfig>,
): SmithersConfig {
  return {
    identity: {
      ...DEFAULTS.identity,
      ...partial.identity,
      internal_email_domains:
        partial.identity?.internal_email_domains?.length
          ? partial.identity.internal_email_domains
          : DEFAULTS.identity.internal_email_domains,
    },
    paths: {
      ...DEFAULTS.paths,
      ...partial.paths,
      my_voice: partial.paths?.my_voice ?? DEFAULTS.paths.my_voice ?? "",
    },
    mcps: {
      context_a8c: { ...DEFAULTS.mcps.context_a8c, ...partial.mcps?.context_a8c },
      hive_mind: { ...DEFAULTS.mcps.hive_mind, ...partial.mcps?.hive_mind },
      fathom: { ...DEFAULTS.mcps.fathom, ...partial.mcps?.fathom },
    },
    agents: { ...DEFAULTS.agents, ...partial.agents },
    transcription: { ...DEFAULTS.transcription, ...partial.transcription },
    p2: { ...DEFAULTS.p2, ...partial.p2 },
    working_rhythm: {
      ...DEFAULTS.working_rhythm,
      ...partial.working_rhythm,
    },
    stall_thresholds: {
      ...DEFAULTS.stall_thresholds,
      ...partial.stall_thresholds,
    },
    follow_ups: {
      ...DEFAULTS.follow_ups,
      ...partial.follow_ups,
    },
    schedule: {
      daily_briefing: {
        enabled:
          partial.schedule?.daily_briefing?.enabled ??
          DEFAULTS.schedule?.daily_briefing?.enabled ??
          false,
        time:
          partial.schedule?.daily_briefing?.time ??
          DEFAULTS.schedule?.daily_briefing?.time,
      },
      ping_monitor: {
        enabled:
          partial.schedule?.ping_monitor?.enabled ??
          DEFAULTS.schedule?.ping_monitor?.enabled ??
          false,
        interval_minutes:
          partial.schedule?.ping_monitor?.interval_minutes ??
          DEFAULTS.schedule?.ping_monitor?.interval_minutes ??
          15,
      },
      fathom_sync: {
        enabled:
          partial.schedule?.fathom_sync?.enabled ??
          DEFAULTS.schedule?.fathom_sync?.enabled ??
          false,
        interval_minutes:
          partial.schedule?.fathom_sync?.interval_minutes ??
          DEFAULTS.schedule?.fathom_sync?.interval_minutes ??
          60,
      },
      hive_mind_sync: {
        enabled:
          partial.schedule?.hive_mind_sync?.enabled ??
          DEFAULTS.schedule?.hive_mind_sync?.enabled ??
          false,
        interval_minutes:
          partial.schedule?.hive_mind_sync?.interval_minutes ??
          DEFAULTS.schedule?.hive_mind_sync?.interval_minutes ??
          30,
      },
      team_roster_sync: {
        enabled:
          partial.schedule?.team_roster_sync?.enabled ??
          DEFAULTS.schedule?.team_roster_sync?.enabled ??
          false,
        interval_minutes:
          partial.schedule?.team_roster_sync?.interval_minutes ??
          DEFAULTS.schedule?.team_roster_sync?.interval_minutes ??
          7 * 24 * 60,
        group_slug:
          partial.schedule?.team_roster_sync?.group_slug ??
          DEFAULTS.schedule?.team_roster_sync?.group_slug ??
          "team-51",
      },
    },
    weekly_update: partial.weekly_update,
  };
}
