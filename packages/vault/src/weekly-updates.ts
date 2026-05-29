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
  /**
   * AI's first-pass output snapshotted on initial save. Stays put
   * through subsequent edits so the learn-from-archives loop can
   * compute the user's edit diff vs the generator. Unset on files
   * the user hand-wrote (no AI generation step).
   */
  original_body?: string;
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
  /**
   * AI's first pass. Only written when the existing file has no
   * snapshot yet (or when explicitly overwriting via a regenerate).
   * Pass `null` to clear, `undefined` to leave the existing value
   * untouched.
   */
  original_body?: string | null;
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
  // original_body semantics: null = clear, string = overwrite,
  // undefined = leave whatever was in the file alone. The "preserve
  // existing through edits" behavior comes from the spread of
  // existingFm above + treating undefined as a no-op here.
  if (input.original_body === null) {
    delete fm.original_body;
  } else if (typeof input.original_body === "string") {
    fm.original_body = input.original_body;
  }

  const serialized = matter.stringify(input.body, fm as Record<string, unknown>);
  await writeFileAtomic(abs, serialized);
  return {
    relative_path: relative(opts.vaultPath, abs),
    absolute_path: abs,
  };
}

export interface WeeklyUpdateWithDiff {
  iso_week: string;
  /** AI's first pass (frontmatter `original_body`). */
  original_body: string;
  /** Current body — the user's final after edits. */
  final_body: string;
  /** Identifier of the format template the original was generated with. */
  format_template?: string;
  /** When the original was generated, ISO timestamp. */
  generated_at?: string;
}

/**
 * Return up to N most recent weekly-update files whose frontmatter
 * carries both an `original_body` snapshot AND a body that diverged
 * from it (real edits, not just open-and-save). The learn-from-archives
 * loop only learns from divergences — saving the AI's first pass
 * verbatim doesn't teach anything.
 *
 * Files without an `original_body` (hand-written, or pre-WU3 vintage)
 * are skipped silently — they pre-date the snapshot mechanism.
 */
export async function listWeeklyUpdatesWithDiffs(
  opts: ResolvedVaultOptions,
  limit: number = 5,
): Promise<WeeklyUpdateWithDiff[]> {
  const paths = vaultPaths(opts);
  const files = await listMarkdownFiles(paths.weeklyUpdates);
  const out: WeeklyUpdateWithDiff[] = [];
  for (const f of files) {
    const m = WEEKLY_RE.exec(f);
    if (!m) continue;
    const abs = join(paths.weeklyUpdates, f);
    const raw = await tryReadFile(abs);
    if (raw === null) continue;
    const parsed = matter(raw);
    const fm = (parsed.data ?? {}) as WeeklyUpdateFrontmatter;
    const original = fm.original_body;
    const final = parsed.content;
    if (typeof original !== "string" || !original.trim()) continue;
    if (original.trim() === final.trim()) continue;
    out.push({
      iso_week: `${m[1]}-W${m[2]}`,
      original_body: original,
      final_body: final,
      format_template: fm.format_template,
      generated_at: fm.generated_at,
    });
  }
  // Most-recent first by ISO week.
  out.sort((a, b) => b.iso_week.localeCompare(a.iso_week));
  return out.slice(0, limit);
}
