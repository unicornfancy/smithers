"use server";

import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expandConfigPath, loadConfig } from "@/lib/server/config";
import {
  configLocalPath as sharedConfigLocalPath,
  findRepoRoot,
  isObject,
  readYamlFile,
  tryReadText,
  writeTextAtomic,
  writeYamlAtomic,
} from "@/lib/server/config-write";

export interface SetupStatus {
  paths: {
    vault: PathEntry;
    hive_mind: PathEntry;
    my_voice: PathEntry;
  };
  identity: {
    name: string;
    email: string;
    github_handle: string;
    slack_handle: string;
  };
  api_keys: {
    anthropic: { set: boolean };
    linear: { set: boolean };
  };
  mcps: {
    context_a8c: { enabled: boolean };
    hive_mind: { enabled: boolean };
    fathom: { enabled: boolean };
  };
  hive_mind_server: {
    configured_path: string;
    built: boolean;
  };
  config_local: {
    path: string;
    exists: boolean;
  };
  /** Kept for backwards-compat with anything reading the previous shape. */
  config_local_path: string;
}

export interface PathEntry {
  value: string;
  resolved: string;
  exists: boolean;
  /**
   * Set when `exists` is true but the target is the wrong kind (e.g. a
   * file where we want a directory). Surfaces as a distinct warning in
   * the wizard so users don't see a green "Found" for a misconfigured
   * path.
   */
  is_directory: boolean;
}

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; reason: string };

export async function getSetupStatusAction(): Promise<SetupStatus> {
  const cfg = await loadConfig();
  const repoRoot = findRepoRoot();
  const configLocalPath = join(repoRoot, "config.local.yaml");

  const vaultResolved = cfg.paths.vault ? expandConfigPath(cfg.paths.vault) : "";
  const hiveMindResolved = cfg.paths.hive_mind
    ? expandConfigPath(cfg.paths.hive_mind)
    : "";
  const myVoiceResolved = cfg.paths.my_voice
    ? expandConfigPath(cfg.paths.my_voice)
    : "";

  const hiveMindServerPath = hiveMindResolved
    ? join(hiveMindResolved, "mcp/server/dist/index.js")
    : "";

  return {
    paths: {
      vault: pathEntry(cfg.paths.vault, vaultResolved),
      hive_mind: pathEntry(cfg.paths.hive_mind, hiveMindResolved),
      my_voice: pathEntry(cfg.paths.my_voice ?? "", myVoiceResolved),
    },
    identity: {
      name: cfg.identity.name ?? "",
      email: cfg.identity.email ?? "",
      github_handle: cfg.identity.github_handle ?? "",
      slack_handle: cfg.identity.slack_handle ?? "",
    },
    api_keys: {
      anthropic: { set: nonEmpty(process.env["ANTHROPIC_API_KEY"]) },
      linear: { set: nonEmpty(process.env["LINEAR_API_KEY"]) },
    },
    mcps: {
      context_a8c: { enabled: cfg.mcps.context_a8c.enabled },
      hive_mind: { enabled: cfg.mcps.hive_mind.enabled },
      fathom: { enabled: cfg.mcps.fathom.enabled },
    },
    hive_mind_server: {
      configured_path: hiveMindServerPath,
      built: hiveMindServerPath ? existsSync(hiveMindServerPath) : false,
    },
    config_local: {
      path: configLocalPath,
      exists: existsSync(configLocalPath),
    },
    config_local_path: configLocalPath,
  };
}

function pathEntry(value: string, resolved: string): PathEntry {
  if (!resolved) {
    return { value, resolved, exists: false, is_directory: false };
  }
  if (!existsSync(resolved)) {
    return { value, resolved, exists: false, is_directory: false };
  }
  let isDir = false;
  try {
    isDir = statSync(resolved).isDirectory();
  } catch {
    // permissions or transient FS error — treat as missing rather than
    // crashing the whole wizard load.
    return { value, resolved, exists: false, is_directory: false };
  }
  return { value, resolved, exists: true, is_directory: isDir };
}

interface PathsPatch {
  vault?: string;
  hive_mind?: string;
  my_voice?: string;
}

export async function updatePathsAction(
  input: PathsPatch,
): Promise<ActionResult> {
  try {
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const paths = isObject(next["paths"])
      ? (next["paths"] as Record<string, unknown>)
      : {};
    let changed = false;
    for (const key of ["vault", "hive_mind", "my_voice"] as const) {
      if (input[key] === undefined) continue;
      const incoming = input[key] ?? "";
      const existing = typeof paths[key] === "string" ? (paths[key] as string) : "";
      if (incoming === existing) continue;
      if (incoming === "") delete paths[key];
      else paths[key] = incoming;
      changed = true;
    }
    if (!changed) return { ok: true };
    if (Object.keys(paths).length > 0) next["paths"] = paths;
    else delete next["paths"];
    await writeYamlAtomic(path, next);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "write-failed",
    };
  }
}

interface IdentityPatch {
  name?: string;
  email?: string;
  github_handle?: string;
  slack_handle?: string;
}

export async function updateIdentityAction(
  input: IdentityPatch,
): Promise<ActionResult> {
  try {
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const identity = isObject(next["identity"])
      ? (next["identity"] as Record<string, unknown>)
      : {};
    let changed = false;
    for (const key of [
      "name",
      "email",
      "github_handle",
      "slack_handle",
    ] as const) {
      if (input[key] === undefined) continue;
      const incoming = (input[key] ?? "").trim();
      const existing =
        typeof identity[key] === "string" ? (identity[key] as string) : "";
      if (incoming === existing) continue;
      if (incoming === "") delete identity[key];
      else identity[key] = incoming;
      changed = true;
    }
    if (!changed) return { ok: true };
    if (Object.keys(identity).length > 0) next["identity"] = identity;
    else delete next["identity"];
    await writeYamlAtomic(path, next);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "write-failed",
    };
  }
}

interface McpsPatch {
  context_a8c?: boolean;
  hive_mind?: boolean;
  fathom?: boolean;
}

export async function updateMcpsAction(
  input: McpsPatch,
): Promise<ActionResult> {
  try {
    const path = configLocalPath();
    const current = await readYamlFile(path);
    const next = structuredClone(current) as Record<string, unknown>;
    const mcps = isObject(next["mcps"])
      ? (next["mcps"] as Record<string, unknown>)
      : {};
    let changed = false;
    for (const key of ["context_a8c", "hive_mind", "fathom"] as const) {
      if (input[key] === undefined) continue;
      const enabled = Boolean(input[key]);
      const entry = isObject(mcps[key])
        ? (mcps[key] as Record<string, unknown>)
        : {};
      const existing =
        typeof entry["enabled"] === "boolean" ? entry["enabled"] : undefined;
      if (existing === enabled) continue;
      entry["enabled"] = enabled;
      mcps[key] = entry;
      changed = true;
    }
    if (!changed) return { ok: true };
    next["mcps"] = mcps;
    await writeYamlAtomic(path, next);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "write-failed",
    };
  }
}

export async function updateApiKeyAction(input: {
  name: "ANTHROPIC_API_KEY" | "LINEAR_API_KEY";
  value: string;
}): Promise<ActionResult> {
  try {
    if (input.name !== "ANTHROPIC_API_KEY" && input.name !== "LINEAR_API_KEY") {
      return { ok: false, reason: "invalid-key-name" };
    }
    const path = envLocalPath();
    const existing = await tryReadText(path);
    const next = patchEnvFile(existing ?? "", input.name, input.value);
    if (next === (existing ?? "")) return { ok: true };
    await writeTextAtomic(path, next);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "write-failed",
    };
  }
}

// --- internals ---

function nonEmpty(v: string | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function configLocalPath(): string {
  return sharedConfigLocalPath();
}

function envLocalPath(): string {
  return join(findRepoRoot(), "apps/web/.env.local");
}

/**
 * Patch a single `<NAME>=...` line in a .env file.
 * Empty value removes the line. Preserves blank lines and `#` comments.
 * Quotes the value only if it contains whitespace, `#`, or quote characters.
 */
function patchEnvFile(source: string, name: string, value: string): string {
  const trimmed = value.trim();
  const lines = source.length === 0 ? [] : source.split(/\r?\n/);
  // Preserve trailing newline if present in the original.
  let trailingNewline = source.endsWith("\n");
  if (trailingNewline && lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const targetPattern = new RegExp(`^\\s*${escapeRegex(name)}\\s*=`);
  let replaced = false;
  const next: string[] = [];
  for (const line of lines) {
    if (targetPattern.test(line)) {
      if (trimmed === "") {
        // drop this line
        replaced = true;
        continue;
      }
      if (!replaced) {
        next.push(`${name}=${formatEnvValue(trimmed)}`);
        replaced = true;
      }
      // Subsequent duplicates are dropped.
      continue;
    }
    next.push(line);
  }
  if (!replaced && trimmed !== "") {
    next.push(`${name}=${formatEnvValue(trimmed)}`);
  }
  // Re-add a trailing newline if the original had one, or if we wrote anything.
  if (next.length === 0) return "";
  if (!trailingNewline) trailingNewline = true;
  return next.join("\n") + (trailingNewline ? "\n" : "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatEnvValue(value: string): string {
  if (/[\s#"'`$]/.test(value)) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}
