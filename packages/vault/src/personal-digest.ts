import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";

import matter from "gray-matter";

import type { ResolvedVaultOptions } from "./config";
import {
  fileMtime,
  listMarkdownFiles,
  tryReadFile,
  writeFileAtomic,
} from "./fs";
import { vaultPaths } from "./paths";

/**
 * Personal Digest is the partner-NDA-safe personal-reflection surface.
 * Two artifact types live under `<vault>/Personal Digest/`:
 *
 *   - Weekly highlights: one markdown file per ISO week (YYYY-WNN.md).
 *     Free-form body capturing "what's worth remembering from this week."
 *     Optional frontmatter tracks generation + save timestamps.
 *   - Development tracker: a single `Development.md` file at the root
 *     of the folder. Free-form running surface for goals, skills,
 *     things to revisit. Same edit semantics as the style guide.
 *
 * Neither artifact syncs to Hive Mind. This is personal context only.
 */
const HIGHLIGHT_RE = /^(\d{4})-W(\d{2})\.md$/i;

export interface WeeklyHighlightRow {
  iso_week: string;
  year: number;
  week: number;
  relative_path: string;
  modified_at: string | null;
}

export interface WeeklyHighlight extends WeeklyHighlightRow {
  body: string;
  frontmatter: WeeklyHighlightFrontmatter;
}

export interface WeeklyHighlightFrontmatter {
  iso_week?: string;
  created_at?: string;
  last_saved_at?: string;
}

export async function listWeeklyHighlights(
  opts: ResolvedVaultOptions,
): Promise<WeeklyHighlightRow[]> {
  const paths = vaultPaths(opts);
  const files = await listMarkdownFiles(paths.personalDigest);
  const rows: WeeklyHighlightRow[] = [];
  for (const f of files) {
    const m = HIGHLIGHT_RE.exec(f);
    if (!m) continue;
    const abs = join(paths.personalDigest, f);
    rows.push({
      iso_week: `${m[1]}-W${m[2]}`,
      year: Number(m[1]),
      week: Number(m[2]),
      relative_path: relative(opts.vaultPath, abs),
      modified_at: await fileMtime(abs),
    });
  }
  rows.sort((a, b) =>
    a.year === b.year ? a.week - b.week : a.year - b.year,
  );
  return rows;
}

export async function readWeeklyHighlight(
  opts: ResolvedVaultOptions,
  isoWeek: string,
): Promise<WeeklyHighlight | null> {
  const m = /^(\d{4})-W(\d{2})$/i.exec(isoWeek);
  if (!m) return null;
  const paths = vaultPaths(opts);
  const filename = `${m[1]}-W${m[2]}.md`;
  const abs = join(paths.personalDigest, filename);
  const raw = await tryReadFile(abs);
  if (raw === null) return null;
  const parsed = matter(raw);
  return {
    iso_week: `${m[1]}-W${m[2]}`,
    year: Number(m[1]),
    week: Number(m[2]),
    relative_path: relative(opts.vaultPath, abs),
    modified_at: await fileMtime(abs),
    body: parsed.content,
    frontmatter: (parsed.data ?? {}) as WeeklyHighlightFrontmatter,
  };
}

export interface SaveWeeklyHighlightInput {
  iso_week: string;
  body: string;
}

export interface SaveWeeklyHighlightResult {
  iso_week: string;
  relative_path: string;
  changed: boolean;
}

export async function saveWeeklyHighlight(
  opts: ResolvedVaultOptions,
  input: SaveWeeklyHighlightInput,
): Promise<SaveWeeklyHighlightResult> {
  const m = /^(\d{4})-W(\d{2})$/i.exec(input.iso_week);
  if (!m) throw new Error(`Bad iso_week "${input.iso_week}"`);
  const paths = vaultPaths(opts);
  await mkdir(paths.personalDigest, { recursive: true });
  const filename = `${m[1]}-W${m[2]}.md`;
  const abs = join(paths.personalDigest, filename);
  const existingRaw = await tryReadFile(abs);
  const existing = existingRaw ? matter(existingRaw) : null;
  const now = new Date().toISOString();
  const nextFrontmatter: WeeklyHighlightFrontmatter = {
    ...(existing?.data ?? {}),
    iso_week: `${m[1]}-W${m[2]}`,
    created_at:
      (existing?.data as WeeklyHighlightFrontmatter | undefined)?.created_at ??
      now,
    last_saved_at: now,
  };
  const body = input.body.replace(/\s+$/, "");
  const next = matter.stringify(body ? `\n${body}\n` : "\n", nextFrontmatter);
  if (existingRaw === next) {
    return {
      iso_week: nextFrontmatter.iso_week!,
      relative_path: relative(opts.vaultPath, abs),
      changed: false,
    };
  }
  await writeFileAtomic(abs, next);
  return {
    iso_week: nextFrontmatter.iso_week!,
    relative_path: relative(opts.vaultPath, abs),
    changed: true,
  };
}

// --- Personal Development tracker --------------------------------------

export interface PersonalDevelopment {
  body: string;
  relative_path: string;
  modified_at: string | null;
}

const DEVELOPMENT_DEFAULT_BODY = `# Personal Development

*Running surface for goals, skills you're learning, things worth revisiting. Edited inline; never auto-modified by Smithers.*

## Goals

- (e.g. ship Smithers v1 to wider audience by Q3)

## Currently learning

- (e.g. Anthropic Workbench + tool-use patterns)

## Things to revisit

- (e.g. that staging-URL workflow I keep relearning every quarter)
`;

export async function readPersonalDevelopment(
  opts: ResolvedVaultOptions,
): Promise<PersonalDevelopment> {
  const paths = vaultPaths(opts);
  const raw = await tryReadFile(paths.personalDevelopment);
  return {
    body: raw ?? DEVELOPMENT_DEFAULT_BODY,
    relative_path: relative(opts.vaultPath, paths.personalDevelopment),
    modified_at: await fileMtime(paths.personalDevelopment),
  };
}

export interface SavePersonalDevelopmentResult {
  relative_path: string;
  changed: boolean;
}

export async function savePersonalDevelopment(
  opts: ResolvedVaultOptions,
  body: string,
): Promise<SavePersonalDevelopmentResult> {
  const paths = vaultPaths(opts);
  await mkdir(paths.personalDigest, { recursive: true });
  const existing = await tryReadFile(paths.personalDevelopment);
  const next = body.replace(/\s+$/, "") + "\n";
  if (existing === next) {
    return {
      relative_path: relative(opts.vaultPath, paths.personalDevelopment),
      changed: false,
    };
  }
  await writeFileAtomic(paths.personalDevelopment, next);
  return {
    relative_path: relative(opts.vaultPath, paths.personalDevelopment),
    changed: true,
  };
}
