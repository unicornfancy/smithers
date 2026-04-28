import { join, relative } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import { fileMtime, listDir, tryReadFile, writeFileAtomic } from "./fs";
import {
  mergeFrontmatter,
  parseMarkdown,
  serializeMarkdown,
} from "./frontmatter";
import { newId } from "./ids";
import { vaultPaths } from "./paths";
import { extractFirstHeading, slugify, withoutMdExt } from "./slug";
import type {
  Project,
  ProjectFrontmatter,
  ProjectKind,
  ProjectSource,
  ProjectStatus,
} from "./types";

/**
 * List every project in the vault.
 *
 * Two physical layouts are supported, mirroring the existing personal-OS:
 *
 * 1. **Flat file** — `Projects/<Name>.md` (most of the existing vault)
 * 2. **Folder** — `Projects/<Name>/info.md` (or `Projects/<Name>/<Name>.md`,
 *    or first markdown file in the folder) — used for richer projects with
 *    `notes.md`, `agenda.md`, `deadlines.md` siblings.
 *
 * Either layout produces the same `Project` shape. Folder layout takes
 * precedence when both exist for the same name.
 */
export async function listProjects(
  opts: ResolvedVaultOptions,
): Promise<Project[]> {
  const paths = vaultPaths(opts);
  const entries = await listDir(paths.projects);

  const seen = new Set<string>();
  const out: Project[] = [];

  // Folder-layout projects first, so they win over a same-named flat file.
  for (const e of entries) {
    if (!e.isDirectory) continue;
    const folderPath = join(paths.projects, e.name);
    const project = await readFolderProject(opts, folderPath, e.name);
    if (project) {
      out.push(project);
      seen.add(project.slug);
    }
  }

  for (const e of entries) {
    if (!e.isFile || !e.name.toLowerCase().endsWith(".md")) continue;
    const filePath = join(paths.projects, e.name);
    const project = await readFlatProject(opts, filePath, e.name);
    if (project && !seen.has(project.slug)) {
      out.push(project);
      seen.add(project.slug);
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Read a single project by slug. Returns `null` if no matching folder or file.
 */
export async function readProject(
  opts: ResolvedVaultOptions,
  slug: string,
): Promise<Project | null> {
  const paths = vaultPaths(opts);
  const entries = await listDir(paths.projects);
  for (const e of entries) {
    if (e.isDirectory && slugify(e.name) === slug) {
      const folderPath = join(paths.projects, e.name);
      return readFolderProject(opts, folderPath, e.name);
    }
  }
  for (const e of entries) {
    if (
      e.isFile &&
      e.name.toLowerCase().endsWith(".md") &&
      slugify(withoutMdExt(e.name)) === slug
    ) {
      return readFlatProject(opts, join(paths.projects, e.name), e.name);
    }
  }
  return null;
}

/**
 * Ensure a project file has a stable `project_id` in its frontmatter.
 * Adds one only if missing; safe to call repeatedly. Returns the (possibly
 * generated) id.
 */
export async function ensureProjectId(
  opts: ResolvedVaultOptions,
  project: Project,
): Promise<string> {
  if (project.source.kind === "hive-mind") {
    // Hive Mind writes go through a separate flow; we don't mutate that file here.
    return project.project_id;
  }
  const path = project.source.absolute_path;
  const raw = await tryReadFile(path);
  if (!raw) return project.project_id;
  const { data, content } = parseMarkdown(raw);
  if (data.project_id) return String(data.project_id);
  const id = project.project_id || newId();
  const merged = mergeFrontmatter(data, {
    project_id: id,
    slug: project.slug,
    name: project.name,
    kind: project.kind,
    status: project.status,
  });
  await writeFileAtomic(path, serializeMarkdown(merged, content));
  return id;
}

// --- internals ---

async function readFolderProject(
  opts: ResolvedVaultOptions,
  folderPath: string,
  folderName: string,
): Promise<Project | null> {
  const candidates = [
    "info.md",
    "INFO.md",
    `${folderName}.md`,
  ];
  const entries = await listDir(folderPath);
  const fileEntry =
    entries.find((e) => e.isFile && candidates.includes(e.name)) ??
    entries.find(
      (e) => e.isFile && e.name.toLowerCase().endsWith(".md"),
    );
  if (!fileEntry) return null;

  const filePath = join(folderPath, fileEntry.name);
  return projectFromFile(opts, {
    filePath,
    folderName,
    fallbackName: folderName,
    source: {
      kind: "vault-folder",
      absolute_path: filePath,
      relative_path: relative(opts.vaultPath, filePath),
      folder_path: folderPath,
    },
  });
}

async function readFlatProject(
  opts: ResolvedVaultOptions,
  filePath: string,
  fileName: string,
): Promise<Project | null> {
  return projectFromFile(opts, {
    filePath,
    folderName: undefined,
    fallbackName: withoutMdExt(fileName),
    source: {
      kind: "vault-flat",
      absolute_path: filePath,
      relative_path: relative(opts.vaultPath, filePath),
    },
  });
}

async function projectFromFile(
  opts: ResolvedVaultOptions,
  args: {
    filePath: string;
    folderName: string | undefined;
    fallbackName: string;
    source: ProjectSource;
  },
): Promise<Project | null> {
  const raw = await tryReadFile(args.filePath);
  if (raw === null) return null;

  const { data, content } = parseMarkdown(raw);
  const fm = data as ProjectFrontmatter;
  const heading = extractFirstHeading(content);

  const name = fm.name ?? heading ?? args.fallbackName;
  const slug = fm.slug ?? slugify(args.folderName ?? args.fallbackName);
  const kind: ProjectKind = fm.kind ?? "personal";
  const status: ProjectStatus = fm.status ?? "active";

  const mtime =
    (await fileMtime(args.filePath)) ?? new Date(0).toISOString();

  return {
    project_id: fm.project_id ?? deriveStableLocalId(args.source),
    slug,
    name,
    kind,
    status,
    source: args.source,
    partner: fm.partner,
    github_repo: fm.github_repo,
    staging_url: fm.staging_url,
    production_url: fm.production_url,
    linear_project_id: fm.linear_project_id,
    linear_project_slug: fm.linear_project_slug,
    zendesk_org: fm.zendesk_org,
    p2_url: fm.p2_url,
    primary_slack_channel: fm.primary_slack_channel,
    team_slack_channel: fm.team_slack_channel,
    agenda_file: fm.agenda_file,
    next_nudge: fm.next_nudge,
    review_interval_days: fm.review_interval_days,
    nda: fm.nda,
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    heading,
    modified_at: mtime,
  };
}

/**
 * Derive a temporary id from a file path so the UI can key off it before
 * the user opts into having a real `project_id` written into frontmatter.
 *
 * Marked with a `local:` prefix so we know it's not a real UUID and can
 * upgrade it via `ensureProjectId` on first edit.
 */
function deriveStableLocalId(source: ProjectSource): string {
  return `local:${source.relative_path}`;
}
