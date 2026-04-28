import { join, relative } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import { fileMtime, listMarkdownFiles, tryReadFile } from "./fs";
import { vaultPaths } from "./paths";
import type { DailyNote } from "./types";

const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

/** List daily notes in chronological order (oldest first). Filenames are `YYYY-MM-DD.md`. */
export async function listDailyNotes(
  opts: ResolvedVaultOptions,
): Promise<{ date: string; relative_path: string }[]> {
  const paths = vaultPaths(opts);
  const files = await listMarkdownFiles(paths.dailyNotes);
  const out: { date: string; relative_path: string }[] = [];
  for (const f of files) {
    const m = f.match(DATE_RE);
    if (!m) continue;
    out.push({
      date: m[1]!,
      relative_path: relative(opts.vaultPath, join(paths.dailyNotes, f)),
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Read a single daily note by ISO date. */
export async function readDailyNote(
  opts: ResolvedVaultOptions,
  date: string,
): Promise<DailyNote | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const paths = vaultPaths(opts);
  const file = join(paths.dailyNotes, `${date}.md`);
  const raw = await tryReadFile(file);
  if (raw === null) return null;
  return {
    date,
    absolute_path: file,
    relative_path: relative(opts.vaultPath, file),
    body: raw,
    modified_at: (await fileMtime(file)) ?? new Date(0).toISOString(),
  };
}

/** Today's daily note, or `null` if it doesn't exist yet. */
export async function readTodayNote(
  opts: ResolvedVaultOptions,
): Promise<DailyNote | null> {
  const today = new Date().toISOString().slice(0, 10);
  return readDailyNote(opts, today);
}
