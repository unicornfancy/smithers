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
import { parseMarkdown, serializeMarkdown } from "./frontmatter";
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
  /**
   * H3 sub-heading the item lives under within `## Open Items`. Used to
   * segment a per-partner agenda into per-project buckets — e.g. an item
   * under `### Phase 2` matches the Pocket NYC Phase 2 project workbench.
   * Undefined for items that appear before the first H3 (general /
   * partner-level items).
   */
  group?: string;
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
  /**
   * Partner slug from frontmatter (`partner: <slug>`). The workbench
   * uses this to wire an agenda file to a project — every project
   * sharing this partner shows the same agenda. Backfilled manually
   * for files that pre-date the field; unset means the file isn't
   * yet linked.
   */
  partner?: string;
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
  // Strip frontmatter first; the body parser walks markdown lines.
  const { data: fm, content: body } = parseMarkdown(raw);
  const partner =
    typeof fm.partner === "string" && fm.partner.trim()
      ? fm.partner.trim()
      : undefined;

  const lines = body.split(/\r?\n/);
  const titleMatch = lines.find((l) => l.startsWith("# "));
  const title = titleMatch
    ? titleMatch.slice(2).trim()
    : filename.replace(/\.md$/i, "");

  // Find the Open Items section (between `## Open Items` and the next `---`
  // divider or `## ` heading or EOF). Within that section, items are
  // grouped by H3 sub-headings (`### Phase 2` → group: "Phase 2"). Items
  // appearing before the first H3 get group: undefined (general).
  const openHeadingIdx = lines.findIndex((l) =>
    /^##\s+Open Items\s*$/i.test(l),
  );
  const open_items: AgendaItem[] = [];
  let archiveStartIdx = lines.length;
  if (openHeadingIdx !== -1) {
    let currentGroup: string | undefined = undefined;
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
      const h3 = /^###\s+(.+?)\s*$/.exec(line);
      if (h3) {
        currentGroup = h3[1]!.trim();
        i += 1;
        continue;
      }
      const itemMatch = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (itemMatch) {
        const text = itemMatch[2]!.trim();
        if (text) {
          open_items.push({
            id: deterministicId(filename, text),
            text,
            checked: itemMatch[1]!.toLowerCase() === "x",
            group: currentGroup,
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

  return {
    filename,
    title,
    partner,
    open_items,
    archived,
    raw,
    modified_at: mtime,
  };
}

export interface AgendaMutationResult {
  changed: boolean;
}

/**
 * Append a new unchecked item to the Open Items list. Creates the
 * `## Open Items` section if missing. No-op when `text` is empty.
 *
 * When `options.group` is provided, the item is appended under the
 * matching `### <group>` H3 sub-heading (created at the bottom of the
 * Open Items block if it doesn't exist yet). When undefined, the item
 * lands in the "general" zone above any H3s — partner-level items not
 * tied to a specific project.
 */
export async function addAgendaItem(
  opts: ResolvedVaultOptions,
  filename: string,
  text: string,
  options?: { group?: string },
): Promise<AgendaMutationResult> {
  const trimmed = text.trim();
  if (!trimmed) return { changed: false };
  const group = options?.group?.trim() || undefined;
  const paths = vaultPaths(opts);
  const abs = join(paths.agendas, filename);
  const existing = await tryReadFile(abs);
  if (existing === null) {
    // Create a fresh agenda file with the new item.
    const title = filename.replace(/\.md$/i, "");
    const body = group
      ? `# ${title} — Call Agenda\n\n## Open Items\n\n### ${group}\n- [ ] ${trimmed}\n\n---\n`
      : `# ${title} — Call Agenda\n\n## Open Items\n- [ ] ${trimmed}\n\n---\n`;
    await writeFileAtomic(abs, body);
    return { changed: true };
  }

  const { data, content } = parseMarkdown(existing);
  const lines = content.split(/\r?\n/);
  const openIdx = lines.findIndex((l) => /^##\s+Open Items\s*$/i.test(l));
  if (openIdx === -1) {
    // No Open Items section yet — append one right after the title.
    const titleIdx = lines.findIndex((l) => l.startsWith("# "));
    const insertAt = titleIdx >= 0 ? titleIdx + 1 : 0;
    const block = group
      ? ["", "## Open Items", "", `### ${group}`, `- [ ] ${trimmed}`, "", "---", ""]
      : ["", "## Open Items", `- [ ] ${trimmed}`, "", "---", ""];
    lines.splice(insertAt, 0, ...block);
  } else {
    insertInOpenItems(lines, openIdx, trimmed, group);
  }
  await writeFileAtomic(abs, serializeMarkdown(data, lines.join("\n")));
  return { changed: true };
}

/**
 * Locate the right insertion point for a new item within the Open
 * Items block and splice it in. Handles three cases: group requested
 * and H3 exists → append after last item in that group; group
 * requested and H3 missing → create H3 + item at the end of Open
 * Items; no group → append in the general zone (before any H3).
 */
function insertInOpenItems(
  lines: string[],
  openIdx: number,
  trimmed: string,
  group: string | undefined,
): void {
  // Walk to the end of the Open Items block.
  let blockEnd = openIdx + 1;
  while (blockEnd < lines.length) {
    const l = lines[blockEnd]!;
    if (/^---\s*$/.test(l) || /^##\s+/.test(l)) break;
    blockEnd += 1;
  }
  // Trim trailing blank lines.
  let endTrimmed = blockEnd;
  while (endTrimmed > openIdx + 1 && lines[endTrimmed - 1]!.trim() === "") {
    endTrimmed -= 1;
  }

  if (group === undefined) {
    // General zone = everything from openIdx+1 to the first H3 (or
    // blockEnd if no H3). Insert at end of that zone.
    let generalEnd = openIdx + 1;
    while (generalEnd < endTrimmed) {
      if (/^###\s+/.test(lines[generalEnd]!)) break;
      generalEnd += 1;
    }
    let insertAt = generalEnd;
    while (insertAt > openIdx + 1 && lines[insertAt - 1]!.trim() === "") {
      insertAt -= 1;
    }
    lines.splice(insertAt, 0, `- [ ] ${trimmed}`);
    return;
  }

  // Group requested — find matching H3 within Open Items.
  let h3Idx = -1;
  for (let i = openIdx + 1; i < endTrimmed; i += 1) {
    const h = /^###\s+(.+?)\s*$/.exec(lines[i]!);
    if (h && h[1]!.trim().toLowerCase() === group.toLowerCase()) {
      h3Idx = i;
      break;
    }
  }
  if (h3Idx === -1) {
    // H3 missing — append a new H3 + item at the end of Open Items.
    const block = ["", `### ${group}`, `- [ ] ${trimmed}`];
    lines.splice(endTrimmed, 0, ...block);
    return;
  }
  // H3 found — append after the last item in this group (before next H3,
  // ## heading, or divider).
  let groupEnd = h3Idx + 1;
  while (groupEnd < endTrimmed) {
    const l = lines[groupEnd]!;
    if (/^###\s+/.test(l) || /^##\s+/.test(l) || /^---\s*$/.test(l)) break;
    groupEnd += 1;
  }
  let insertAt = groupEnd;
  while (insertAt > h3Idx + 1 && lines[insertAt - 1]!.trim() === "") {
    insertAt -= 1;
  }
  lines.splice(insertAt, 0, `- [ ] ${trimmed}`);
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
  const { data, content } = parseMarkdown(existing);
  const lines = content.split(/\r?\n/);
  const openIdx = lines.findIndex((l) => /^##\s+Open Items\s*$/i.test(l));
  if (openIdx === -1) return { changed: false };
  // Walk the entire Open Items block including H3 sub-headings — the
  // toggle is id-based, so the group structure is irrelevant for
  // matching.
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
    await writeFileAtomic(abs, serializeMarkdown(data, lines.join("\n")));
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
  const { data, content } = parseMarkdown(existing);
  const lines = content.split(/\r?\n/);
  const openIdx = lines.findIndex((l) => /^##\s+Open Items\s*$/i.test(l));
  if (openIdx === -1) return { changed: false, archived: 0 };

  // Walk Open Items, pulling out checked rows from every H3 group. H3
  // headings are left in place so the group structure persists across
  // archives — an empty group is fine (it just becomes a heading with
  // no items, which the next add re-fills).
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
  await writeFileAtomic(abs, serializeMarkdown(data, lines.join("\n")));
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

export interface CreateAgendaInput {
  /** Display name used in the H1 + filename ("Pocket NYC" → "Pocket NYC.md"). */
  title: string;
  /** Partner slug to write into frontmatter — wires this agenda to every project under the partner. */
  partnerSlug: string;
}

export interface CreateAgendaResult {
  filename: string;
  relative_path: string;
  /** False when a file at that filename already existed and was preserved. */
  created: boolean;
}

/**
 * Scaffold a per-partner agenda file at `Agendas/<title>.md` with the
 * partner slug already wired into frontmatter (so `findAgendaForPartner`
 * picks it up on first load) and the standard Open Items section ready
 * for the workbench to start appending to.
 *
 * Idempotent: if a file with the same name already exists, returns
 * `created: false` and leaves the file untouched. Caller decides
 * whether to surface that as "already exists" or "ok, opening it".
 */
export async function createAgendaForPartner(
  opts: ResolvedVaultOptions,
  input: CreateAgendaInput,
): Promise<CreateAgendaResult> {
  const title = input.title.trim();
  if (!title) throw new Error("Agenda title is required");
  const partnerSlug = input.partnerSlug.trim();
  if (!partnerSlug) throw new Error("Partner slug is required");

  const paths = vaultPaths(opts);
  // Filenames keep the literal title (Katie's existing agendas use display
  // names like "Pocket NYC.md", not slugs). Strip slashes / leading dots
  // so we never escape the agendas dir.
  const safeName = title.replace(/[/\\]/g, "-").replace(/^\.+/, "");
  const filename = `${safeName}.md`;
  const abs = join(paths.agendas, filename);
  const relPath = relative(opts.vaultPath, abs);

  const existing = await tryReadFile(abs);
  if (existing !== null) {
    return { filename, relative_path: relPath, created: false };
  }

  const body = `# ${title} — Call Agenda\n\n## Open Items\n\n---\n`;
  await writeFileAtomic(
    abs,
    serializeMarkdown({ partner: partnerSlug }, body),
  );
  return { filename, relative_path: relPath, created: true };
}
