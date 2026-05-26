// Agenda files live in `Agendas/<Name>.md` — one per partner, used to seed the
// next call. Format (free-form but consistent across Katie's existing files):
//
//   # <Partner> — Call Agenda
//
//   ## Open Items
//   - [ ] running list of things to discuss next call
//   - [x] something that was raised and addressed but not yet archived
//
//   ---
//
//   ## 2026-05-20 (call)
//   - [x] item that was checked off during/after a previous call
//
// "Archive checked items" moves any [x] rows out of Open Items into a fresh
// dated section below the divider.

import { join, relative } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import { fileExists, fileMtime, listMarkdownFiles, tryReadFile, writeFileAtomic } from "./fs";
import { deterministicId } from "./ids";
import { vaultPaths } from "./paths";

export interface AgendaRef {
  absolute_path: string;
  relative_path: string;
  filename: string;
  modified_at: string;
}

export async function listAgendas(
  opts: ResolvedVaultOptions,
): Promise<AgendaRef[]> {
  const paths = vaultPaths(opts);
  const files = await listMarkdownFiles(paths.agendas);
  const out: AgendaRef[] = [];
  for (const f of files) {
    const abs = join(paths.agendas, f);
    out.push({
      absolute_path: abs,
      relative_path: relative(opts.vaultPath, abs),
      filename: f,
      modified_at: (await fileMtime(abs)) ?? new Date(0).toISOString(),
    });
  }
  out.sort((a, b) => a.filename.localeCompare(b.filename));
  return out;
}

export interface AgendaItem {
  /** Deterministic id derived from the row's text; stable until the text changes. */
  id: string;
  text: string;
  checked: boolean;
}

export interface AgendaArchiveSection {
  /** Heading text, e.g. "2026-05-20 (call)". */
  heading: string;
  /** Raw markdown body, preserved verbatim. */
  body: string;
}

export interface Agenda {
  filename: string;
  /** Title from the `# ` H1 line if present, else the filename without extension. */
  title: string;
  open_items: AgendaItem[];
  archived: AgendaArchiveSection[];
  /** Raw file content for fallback rendering. */
  raw: string;
  modified_at: string;
}

export async function readAgenda(
  opts: ResolvedVaultOptions,
  filename: string,
): Promise<Agenda | null> {
  const paths = vaultPaths(opts);
  const abs = join(paths.agendas, filename);
  const raw = await tryReadFile(abs);
  if (raw === null) return null;
  const mtime = (await fileMtime(abs)) ?? new Date(0).toISOString();
  return parseAgenda(filename, raw, mtime);
}

function parseAgenda(filename: string, raw: string, mtime: string): Agenda {
  const lines = raw.split(/\r?\n/);
  const titleMatch = lines.find((l) => l.startsWith("# "));
  const title = titleMatch
    ? titleMatch.slice(2).trim()
    : filename.replace(/\.md$/i, "");

  // Find the Open Items section (between `## Open Items` and the next `---`
  // divider or `## ` heading or EOF).
  const openHeadingIdx = lines.findIndex((l) =>
    /^##\s+Open Items\s*$/i.test(l),
  );
  const open_items: AgendaItem[] = [];
  let archiveStartIdx = lines.length;
  if (openHeadingIdx !== -1) {
    let i = openHeadingIdx + 1;
    while (i < lines.length) {
      const line = lines[i]!;
      if (/^---\s*$/.test(line)) {
        archiveStartIdx = i + 1;
        break;
      }
      if (/^##\s+/.test(line)) {
        archiveStartIdx = i;
        break;
      }
      const itemMatch = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (itemMatch) {
        const text = itemMatch[2]!.trim();
        if (text) {
          open_items.push({
            id: deterministicId(filename, text),
            text,
            checked: itemMatch[1]!.toLowerCase() === "x",
          });
        }
      }
      i += 1;
    }
  }

  // Archived sections — anything that comes after the divider, split on `## `.
  const archived: AgendaArchiveSection[] = [];
  if (archiveStartIdx < lines.length) {
    const archiveLines = lines.slice(archiveStartIdx);
    let currentHeading: string | null = null;
    let currentBody: string[] = [];
    for (const line of archiveLines) {
      const h = /^##\s+(.+?)\s*$/.exec(line);
      if (h) {
        if (currentHeading !== null) {
          archived.push({
            heading: currentHeading,
            body: currentBody.join("\n").trim(),
          });
        }
        currentHeading = h[1]!;
        currentBody = [];
      } else if (currentHeading !== null) {
        currentBody.push(line);
      }
    }
    if (currentHeading !== null) {
      archived.push({
        heading: currentHeading,
        body: currentBody.join("\n").trim(),
      });
    }
  }

  return { filename, title, open_items, archived, raw, modified_at: mtime };
}

export interface AgendaMutationResult {
  changed: boolean;
}

/**
 * Append a new unchecked item to the end of the Open Items list. Creates the
 * `## Open Items` section if missing. No-op when `text` is empty.
 */
export async function addAgendaItem(
  opts: ResolvedVaultOptions,
  filename: string,
  text: string,
): Promise<AgendaMutationResult> {
  const trimmed = text.trim();
  if (!trimmed) return { changed: false };
  const paths = vaultPaths(opts);
  const abs = join(paths.agendas, filename);
  const existing = await tryReadFile(abs);
  if (existing === null) {
    // Create a fresh agenda file with the new item.
    const title = filename.replace(/\.md$/i, "");
    const content = `# ${title} — Call Agenda\n\n## Open Items\n- [ ] ${trimmed}\n\n---\n`;
    await writeFileAtomic(abs, content);
    return { changed: true };
  }
  const lines = existing.split(/\r?\n/);
  const openIdx = lines.findIndex((l) => /^##\s+Open Items\s*$/i.test(l));
  if (openIdx === -1) {
    // No Open Items section yet — append one right after the title.
    const titleIdx = lines.findIndex((l) => l.startsWith("# "));
    const insertAt = titleIdx >= 0 ? titleIdx + 1 : 0;
    const block = ["", "## Open Items", `- [ ] ${trimmed}`, "", "---", ""];
    lines.splice(insertAt, 0, ...block);
  } else {
    // Walk to the end of the Open Items block, then insert before whatever
    // delimiter ends it (divider, next heading, or EOF).
    let endIdx = openIdx + 1;
    while (endIdx < lines.length) {
      const l = lines[endIdx]!;
      if (/^---\s*$/.test(l) || /^##\s+/.test(l)) break;
      endIdx += 1;
    }
    // Trim trailing blank lines inside the block so the new item slots in
    // tight against the existing list.
    let insertAt = endIdx;
    while (insertAt > openIdx + 1 && lines[insertAt - 1]!.trim() === "") {
      insertAt -= 1;
    }
    lines.splice(insertAt, 0, `- [ ] ${trimmed}`);
  }
  await writeFileAtomic(abs, lines.join("\n"));
  return { changed: true };
}

/**
 * Toggle (or set) the checkbox marker for an Open Items row identified by its
 * deterministic id. Returns `changed: false` if the row was already in the
 * requested state, or if no matching row was found.
 */
export async function setAgendaItemChecked(
  opts: ResolvedVaultOptions,
  filename: string,
  itemId: string,
  checked: boolean,
): Promise<AgendaMutationResult> {
  const paths = vaultPaths(opts);
  const abs = join(paths.agendas, filename);
  const existing = await tryReadFile(abs);
  if (existing === null) return { changed: false };
  const lines = existing.split(/\r?\n/);
  const openIdx = lines.findIndex((l) => /^##\s+Open Items\s*$/i.test(l));
  if (openIdx === -1) return { changed: false };
  for (let i = openIdx + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^---\s*$/.test(line) || /^##\s+/.test(line)) break;
    const m = /^([-*]\s+\[)([ xX])(\]\s+)(.*)$/.exec(line);
    if (!m) continue;
    const text = m[4]!.trim();
    if (deterministicId(filename, text) !== itemId) continue;
    const isCurrentlyChecked = m[2]!.toLowerCase() === "x";
    if (isCurrentlyChecked === checked) return { changed: false };
    lines[i] = `${m[1]}${checked ? "x" : " "}${m[3]}${m[4]}`;
    await writeFileAtomic(abs, lines.join("\n"));
    return { changed: true };
  }
  return { changed: false };
}

/**
 * Move every checked Open Items row into a fresh archived section keyed by
 * `dateLabel` (e.g. "2026-05-26"). The section header is appended below the
 * `---` divider, or a new divider + section is created if none exists yet.
 * Returns the count of items archived in `archived`.
 */
export async function archiveCheckedAgendaItems(
  opts: ResolvedVaultOptions,
  filename: string,
  dateLabel: string,
): Promise<{ changed: boolean; archived: number }> {
  const paths = vaultPaths(opts);
  const abs = join(paths.agendas, filename);
  const existing = await tryReadFile(abs);
  if (existing === null) return { changed: false, archived: 0 };
  const lines = existing.split(/\r?\n/);
  const openIdx = lines.findIndex((l) => /^##\s+Open Items\s*$/i.test(l));
  if (openIdx === -1) return { changed: false, archived: 0 };

  // Walk Open Items, pulling out checked rows.
  const archivedRows: string[] = [];
  let i = openIdx + 1;
  let dividerIdx = -1;
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^---\s*$/.test(line)) {
      dividerIdx = i;
      break;
    }
    if (/^##\s+/.test(line)) break;
    if (/^[-*]\s+\[[xX]\]\s+/.test(line)) {
      archivedRows.push(line);
      lines.splice(i, 1);
      continue;
    }
    i += 1;
  }
  if (archivedRows.length === 0) return { changed: false, archived: 0 };

  // Locate (or create) the divider that separates Open Items from archived
  // sections. We re-find it since the splice above may have shifted indices.
  dividerIdx = lines.findIndex((l, idx) => idx > openIdx && /^---\s*$/.test(l));
  if (dividerIdx === -1) {
    // Append a divider after the Open Items block.
    let endIdx = openIdx + 1;
    while (endIdx < lines.length && !/^##\s+/.test(lines[endIdx]!)) endIdx += 1;
    lines.splice(endIdx, 0, "", "---", "");
    dividerIdx = lines.indexOf("---", openIdx + 1);
  }

  const block = [`## ${dateLabel}`, ...archivedRows, ""];
  lines.splice(dividerIdx + 1, 0, "", ...block);
  await writeFileAtomic(abs, lines.join("\n"));
  return { changed: true, archived: archivedRows.length };
}

/** True when the agenda file exists on disk. */
export async function agendaExists(
  opts: ResolvedVaultOptions,
  filename: string,
): Promise<boolean> {
  const paths = vaultPaths(opts);
  return fileExists(join(paths.agendas, filename));
}
