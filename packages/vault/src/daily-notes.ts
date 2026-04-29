import { join, relative } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import {
  fileMtime,
  listMarkdownFiles,
  tryReadFile,
  writeFileAtomic,
} from "./fs";
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

/**
 * Where today's daily note lives on disk (whether or not the file exists).
 * Used for "View source" affordances and external-editor handoff.
 */
export function dailyNotePath(
  opts: ResolvedVaultOptions,
  date: string,
): string {
  return join(vaultPaths(opts).dailyNotes, `${date}.md`);
}

/**
 * Upsert a Smithers-managed section inside a daily note. Sections are
 * fenced by `<!-- smithers:<id> -->` ... `<!-- /smithers:<id> -->`
 * comment markers. The body between the markers is replaced; user-
 * authored content outside the fence is preserved verbatim.
 *
 * If the file doesn't exist: it's created with a default H1 header
 * for the date plus the new fenced section.
 *
 * If the file exists but has no fence for this section: the new
 * fenced block is appended at the bottom.
 *
 * Atomic write — rename-after-temp so readers never see half-written
 * markdown.
 */
export async function upsertDailySection(
  opts: ResolvedVaultOptions,
  date: string,
  sectionId: string,
  bodyMarkdown: string,
): Promise<{ path: string; created: boolean }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(sectionId)) {
    throw new Error(
      `Invalid sectionId "${sectionId}" — expected lowercase + dashes`,
    );
  }

  const path = dailyNotePath(opts, date);
  const existing = (await tryReadFile(path)) ?? "";
  const created = existing.length === 0;

  const next = applyDailySectionEdit(existing, date, sectionId, bodyMarkdown);
  await writeFileAtomic(path, next);
  return { path, created };
}

/**
 * Pure markdown-string transform — exposed as a separate function so
 * unit tests can poke at it without touching disk.
 */
export function applyDailySectionEdit(
  existing: string,
  date: string,
  sectionId: string,
  bodyMarkdown: string,
): string {
  const open = `<!-- smithers:${sectionId} -->`;
  const close = `<!-- /smithers:${sectionId} -->`;
  const body = bodyMarkdown.trim();
  const fenced = `${open}\n${body}\n${close}`;

  if (existing.length === 0) {
    const header = defaultDailyNoteHeader(date);
    return `${header}\n\n${fenced}\n`;
  }

  const startIdx = existing.indexOf(open);
  if (startIdx === -1) {
    // No prior fence — append a fresh block at the end.
    const trimmed = existing.replace(/\s+$/, "");
    return `${trimmed}\n\n${fenced}\n`;
  }

  const closeIdx = existing.indexOf(close, startIdx);
  if (closeIdx === -1) {
    throw new Error(
      `Daily note has unbalanced "${open}" with no matching "${close}"`,
    );
  }
  const before = existing.slice(0, startIdx);
  const after = existing.slice(closeIdx + close.length);
  return `${before}${fenced}${after}`;
}

function defaultDailyNoteHeader(date: string): string {
  const day = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
  });
  return `# ${date} — ${day}`;
}
