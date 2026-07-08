import { dirname, join, relative } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import { fileExists, fileMtime, listDir, tryReadFile, writeFileAtomic } from "./fs";
import { parseMarkdown } from "./frontmatter";
import { readProject } from "./projects";
import { withoutMdExt } from "./slug";
import type { Project } from "./types";

/**
 * The full content of a project, including its body and (for folder-layout
 * projects) sibling files like notes.md, agenda.md, and deadlines.md.
 *
 * `body` is the markdown content of `info.md` (or the flat `Projects/<name>.md`)
 * with frontmatter stripped. Sibling files are included only when present.
 */
export interface ProjectDetail extends Project {
  body: string;
  notes: SiblingFile | null;
  agenda: SiblingFile | null;
  deadlines: SiblingFile | null;
}

export interface SiblingFile {
  path: string;
  relative_path: string;
  body: string;
  modified_at: string;
}

export async function readProjectDetail(
  opts: ResolvedVaultOptions,
  slug: string,
): Promise<ProjectDetail | null> {
  const project = await readProject(opts, slug);
  if (!project) return null;

  const raw = await tryReadFile(project.source.absolute_path);
  const body = raw ? parseMarkdown(raw).content : "";

  const notes = await readPersonalNotes(opts, project);
  const agenda =
    project.source.kind === "vault-folder"
      ? await readSibling(opts, project.source.folder_path, [
          project.agenda_file ?? "agenda.md",
          "Agenda.md",
        ])
      : null;
  const deadlines =
    project.source.kind === "vault-folder"
      ? await readSibling(opts, project.source.folder_path, [
          "deadlines.md",
          "Deadlines.md",
        ])
      : null;

  return { ...project, body, notes, agenda, deadlines };
}

async function readSibling(
  opts: ResolvedVaultOptions,
  folderPath: string,
  candidates: string[],
): Promise<SiblingFile | null> {
  const entries = await listDir(folderPath);
  const present = entries.find(
    (e) => e.isFile && candidates.includes(e.name),
  );
  if (!present) return null;
  const path = join(folderPath, present.name);
  const raw = await tryReadFile(path);
  if (raw === null) return null;
  return {
    path,
    relative_path: relative(opts.vaultPath, path),
    body: raw,
    modified_at: (await fileMtime(path)) ?? new Date(0).toISOString(),
  };
}

/**
 * Resolve the on-disk personal-notes file path for a project. Two
 * layouts:
 *   - vault-folder: `<folder>/notes.md`
 *   - vault-flat:   `Projects/<basename> — notes.md`
 * Hive-Mind projects don't have personal notes (writes would leak to
 * the shared repo). Returns null in that case.
 */
export function personalNotesPathFor(project: Project): string | null {
  if (project.source.kind === "vault-folder") {
    return join(project.source.folder_path, "notes.md");
  }
  if (project.source.kind === "vault-flat") {
    const dir = dirname(project.source.absolute_path);
    const base = withoutMdExt(
      project.source.absolute_path.split("/").pop() ?? project.slug,
    );
    // Em-dash separator so the notes file sorts right next to the
    // project file alphabetically in Finder / Obsidian.
    return join(dir, `${base} — notes.md`);
  }
  return null;
}

async function readPersonalNotes(
  opts: ResolvedVaultOptions,
  project: Project,
): Promise<SiblingFile | null> {
  if (project.source.kind === "vault-folder") {
    return readSibling(opts, project.source.folder_path, [
      "notes.md",
      "Notes.md",
    ]);
  }
  if (project.source.kind === "vault-flat") {
    const path = personalNotesPathFor(project);
    if (!path || !fileExists(path)) return null;
    const raw = await tryReadFile(path);
    if (raw === null) return null;
    return {
      path,
      relative_path: relative(opts.vaultPath, path),
      body: raw,
      modified_at: (await fileMtime(path)) ?? new Date(0).toISOString(),
    };
  }
  return null;
}

/**
 * Save personal notes for a project. Layout-aware:
 *   - vault-folder: writes to `<folder>/notes.md`
 *   - vault-flat:   writes to `Projects/<basename> — notes.md`
 *   - hive-mind:    throws — HM projects don't have local notes.
 *
 * Atomic write via `writeFileAtomic`. Returns `{ path, relative_path,
 * changed }`; `changed` is false when the body matches what was already
 * on disk (idempotent — no timestamp drift on identical saves).
 */
export async function writeProjectPersonalNotes(
  opts: ResolvedVaultOptions,
  slug: string,
  body: string,
): Promise<{ path: string; relative_path: string; changed: boolean }> {
  const project = await readProject(opts, slug);
  if (!project) throw new Error(`Project "${slug}" not found`);
  if (project.source.kind === "hive-mind") {
    throw new Error(
      `Project "${slug}" is a Hive Mind partner project; personal notes stay local, not in the shared repo.`,
    );
  }
  const path = personalNotesPathFor(project);
  if (!path) {
    throw new Error(`No personal-notes location for project "${slug}"`);
  }
  const existing = await tryReadFile(path);
  const normalized = body.endsWith("\n") ? body : `${body}\n`;
  if (existing === normalized) {
    return {
      path,
      relative_path: relative(opts.vaultPath, path),
      changed: false,
    };
  }
  await writeFileAtomic(path, normalized);
  return {
    path,
    relative_path: relative(opts.vaultPath, path),
    changed: true,
  };
}
