import "server-only";

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { parseMarkdown } from "@smithers/vault";

import { loadConfig } from "./config";

/**
 * Filesystem helpers for the user's local Hive Mind clone. The Hive
 * Mind MCP server doesn't exist yet, but the underlying repository
 * is right there at ~/Team51-Hive-Mind/ — and partner content is just
 * markdown files. So we read/write them directly until there's a real
 * MCP API.
 *
 * All writes stop short of `git` — surfacing the diff for the user to
 * review and commit manually is a CLAUDE.md pause point.
 */

export interface HiveMindPartnerSummary {
  slug: string;
  /** Read from `title:` in partner-knowledge.md frontmatter. */
  title: string | null;
  /** From frontmatter; null when the file is missing or unparseable. */
  description: string | null;
  /** From frontmatter. */
  owner: string | null;
  nda: boolean;
  tags: string[];
  /** Path on disk for "open in editor" affordances. */
  absolute_path: string;
  /** Last-modified ISO. */
  modified_at: string;
}

const KNOWLEDGE_FILE = "partner-knowledge.md";

/**
 * Resolve the absolute path to the Hive Mind clone, expanding `~` and
 * resolving relative paths against the repo root (matches the
 * vault-path resolution logic in config.ts).
 */
async function getHiveMindRoot(): Promise<string | null> {
  const cfg = await loadConfig();
  const path = cfg.paths.hive_mind;
  if (!path) return null;
  return path;
}

/** Whether the configured Hive Mind directory exists on disk. */
export async function hiveMindAvailable(): Promise<{
  available: boolean;
  path: string | null;
  reason?: string;
}> {
  const root = await getHiveMindRoot();
  if (!root) {
    return { available: false, path: null, reason: "paths.hive_mind not configured" };
  }
  try {
    const s = await stat(root);
    if (!s.isDirectory()) {
      return { available: false, path: root, reason: "Path is not a directory" };
    }
    return { available: true, path: root };
  } catch {
    return { available: false, path: root, reason: "Directory not found" };
  }
}

/**
 * List partner directories under knowledge/partners/, skipping
 * underscore-prefixed entries (the convention for templates +
 * examples). Each entry parses `partner-knowledge.md` frontmatter for
 * preview metadata.
 */
export async function listHiveMindPartners(): Promise<HiveMindPartnerSummary[]> {
  const status = await hiveMindAvailable();
  if (!status.available || !status.path) return [];

  const partnersDir = join(status.path, "knowledge", "partners");
  let entries: string[];
  try {
    entries = await readdir(partnersDir);
  } catch {
    return [];
  }

  const summaries: HiveMindPartnerSummary[] = [];
  for (const name of entries) {
    if (name.startsWith("_")) continue;
    if (name.startsWith(".")) continue;
    const dir = join(partnersDir, name);
    try {
      const dirStat = await stat(dir);
      if (!dirStat.isDirectory()) continue;
    } catch {
      continue;
    }
    const summary = await readPartnerSummary(dir, name);
    if (summary) summaries.push(summary);
  }
  summaries.sort((a, b) => a.slug.localeCompare(b.slug));
  return summaries;
}

/** Whether a Hive Mind partner directory exists for the given slug. */
export async function hiveMindPartnerExists(slug: string): Promise<boolean> {
  const status = await hiveMindAvailable();
  if (!status.available || !status.path) return false;
  const path = join(status.path, "knowledge", "partners", slug, KNOWLEDGE_FILE);
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the absolute path where a new partner-knowledge.md would be
 * written. Used both for preview rendering and the actual write.
 */
export async function hiveMindPartnerPath(slug: string): Promise<string | null> {
  const status = await hiveMindAvailable();
  if (!status.available || !status.path) return null;
  return join(status.path, "knowledge", "partners", slug, KNOWLEDGE_FILE);
}

/**
 * Read the templates/partner-knowledge.md from the Hive Mind clone so
 * we always match whatever the team's currently using as the template
 * shape — no copy-pasting it into Smithers.
 */
export async function readHiveMindPartnerTemplate(): Promise<string | null> {
  const status = await hiveMindAvailable();
  if (!status.available || !status.path) return null;
  const path = join(status.path, "templates", KNOWLEDGE_FILE);
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

// --- internals ---

async function readPartnerSummary(
  dir: string,
  slug: string,
): Promise<HiveMindPartnerSummary | null> {
  const path = join(dir, KNOWLEDGE_FILE);
  let raw: string;
  let mtime: string;
  try {
    raw = await readFile(path, "utf-8");
    const s = await stat(path);
    mtime = s.mtime.toISOString();
  } catch {
    // No partner-knowledge.md — still surface the slug so the gap-
    // detection step can flag it as half-populated.
    return {
      slug,
      title: null,
      description: null,
      owner: null,
      nda: false,
      tags: [],
      absolute_path: path,
      modified_at: new Date(0).toISOString(),
    };
  }
  const parsed = parseMarkdown(raw);
  const data = parsed.data;
  return {
    slug,
    title: typeof data.title === "string" ? data.title : null,
    description:
      typeof data.description === "string" && data.description !== ""
        ? data.description
        : null,
    owner:
      typeof data.owner === "string" && data.owner !== "" ? data.owner : null,
    nda: data.nda === true,
    tags: Array.isArray(data.tags)
      ? (data.tags as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
    absolute_path: path,
    modified_at: mtime,
  };
}
