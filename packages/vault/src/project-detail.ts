import { join, relative } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import { fileMtime, listDir, tryReadFile } from "./fs";
import { parseMarkdown } from "./frontmatter";
import { readProject } from "./projects";
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

  const notes =
    project.source.kind === "vault-folder"
      ? await readSibling(opts, project.source.folder_path, [
          "notes.md",
          "Notes.md",
        ])
      : null;
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
