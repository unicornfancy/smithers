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
    github_handle?: string;
    slack_handle?: string;
    internal_email_domains: string[];
  };
  paths: {
    vault: string;
    hive_mind: string;
    data: string;
  };
  mcps: {
    context_a8c: { enabled: boolean; endpoint?: string };
    hive_mind: { enabled: boolean; endpoint?: string };
    fathom: { enabled: boolean; endpoint?: string };
  };
  transcription: {
    provider: "fathom" | "granola" | "manual" | "whisper" | "gemini";
  };
  p2: {
    team_p2_url?: string;
    smithers_p2_post_url?: string;
  };
  working_rhythm: {
    timezone: string;
    workdays: string[];
    briefing_time: string;
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
  },
  mcps: {
    context_a8c: { enabled: false },
    hive_mind: { enabled: false },
    fathom: { enabled: false },
  },
  transcription: { provider: "manual" },
  p2: {},
  working_rhythm: {
    timezone: "America/Los_Angeles",
    workdays: ["mon", "tue", "wed", "thu", "fri"],
    briefing_time: "07:30",
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
      cached = mergeWithDefaults(parsed ?? {});
      return cached;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }

  cached = DEFAULTS;
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
    paths: { ...DEFAULTS.paths, ...partial.paths },
    mcps: {
      context_a8c: { ...DEFAULTS.mcps.context_a8c, ...partial.mcps?.context_a8c },
      hive_mind: { ...DEFAULTS.mcps.hive_mind, ...partial.mcps?.hive_mind },
      fathom: { ...DEFAULTS.mcps.fathom, ...partial.mcps?.fathom },
    },
    transcription: { ...DEFAULTS.transcription, ...partial.transcription },
    p2: { ...DEFAULTS.p2, ...partial.p2 },
    working_rhythm: {
      ...DEFAULTS.working_rhythm,
      ...partial.working_rhythm,
    },
  };
}
