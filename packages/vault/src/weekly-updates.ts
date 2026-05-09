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
 * Weekly Updates live as one markdown file per ISO week in
 * `<vault>/Weekly Updates/`. Filenames follow `YYYY-WNN.md` (e.g.
 * `2026-W19.md`). Existing files in Katie's vault are body-only (no
 * frontmatter); the new editor adds minimal frontmatter on save so we
 * can track generation + last-edit times for the index page, but we
 * stay happy reading legacy body-only files.
 */
const WEEKLY_RE = /^(\d{4})-W(\d{2})\.md$/i;

export interface WeeklyUpdateRow {
  /** ISO week id, e.g. "2026-W19". */
  iso_week: string;
  year: number;
  week: number;
  relative_path: string;
  modified_at: string | null;
}

export interface WeeklyUpdate extends WeeklyUpdateRow {
  body: string;
  frontmatter: WeeklyUpdateFrontmatter;
}

export interface WeeklyUpdateFrontmatter {
  iso_week?: string;
  generated_at?: string;
  last_saved_at?: string;
  /** Identifier for the format template used to generate (default | <custom-id>). */
  format_template?: string;
}

/**
 * List weekly update files in chronological order (oldest first). Files
 * with non-conforming names are skipped silently.
 */
export async function listWeeklyUpdates(
  opts: ResolvedVaultOptions,
): Promise<WeeklyUpdateRow[]> {
  const paths = vaultPaths(opts);
  const files = await listMarkdownFiles(paths.weeklyUpdates);
  const rows: WeeklyUpdateRow[] = [];
  for (const f of files) {
    const m = WEEKLY_RE.exec(f);
    if (!m) continue;
    const year = Number(m[1]);
    const week = Number(m[2]);
    const abs = join(paths.weeklyUpdates, f);
    rows.push({
      iso_week: `${m[1]}-W${m[2]}`,
      year,
      week,
      relative_path: relative(opts.vaultPath, abs),
      modified_at: await fileMtime(abs),
    });
  }
  rows.sort((a, b) =>
    a.year === b.year ? a.week - b.week : a.year - b.year,
  );
  return rows;
}

export async function readWeeklyUpdate(
  opts: ResolvedVaultOptions,
  isoWeek: string,
): Promise<WeeklyUpdate | null> {
  const m = /^(\d{4})-W(\d{2})$/i.exec(isoWeek);
  if (!m) return null;
  const paths = vaultPaths(opts);
  const filename = `${m[1]}-W${m[2]}.md`;
  const abs = join(paths.weeklyUpdates, filename);
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
    frontmatter: (parsed.data ?? {}) as WeeklyUpdateFrontmatter,
  };
}

export interface SaveWeeklyUpdateInput {
  iso_week: string;
  body: string;
  /** Optional patches; existing frontmatter fields are preserved when omitted. */
  generated_at?: string;
  format_template?: string;
}

export async function saveWeeklyUpdate(
  opts: ResolvedVaultOptions,
  input: SaveWeeklyUpdateInput,
): Promise<{ relative_path: string; absolute_path: string }> {
  const m = /^(\d{4})-W(\d{2})$/i.exec(input.iso_week);
  if (!m) throw new Error(`Invalid iso_week "${input.iso_week}"`);
  const paths = vaultPaths(opts);
  await mkdir(paths.weeklyUpdates, { recursive: true });
  const filename = `${m[1]}-W${m[2]}.md`;
  const abs = join(paths.weeklyUpdates, filename);

  const existing = await tryReadFile(abs);
  const existingFm = existing ? (matter(existing).data as WeeklyUpdateFrontmatter) : {};

  const fm: WeeklyUpdateFrontmatter = {
    ...existingFm,
    iso_week: input.iso_week,
    last_saved_at: new Date().toISOString(),
  };
  if (input.generated_at) fm.generated_at = input.generated_at;
  if (input.format_template) fm.format_template = input.format_template;

  const serialized = matter.stringify(input.body, fm as Record<string, unknown>);
  await writeFileAtomic(abs, serialized);
  return {
    relative_path: relative(opts.vaultPath, abs),
    absolute_path: abs,
  };
}
