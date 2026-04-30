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
    zendesk_tickets: normalizeZendeskTickets(fm.zendesk_tickets),
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

/**
 * Coerce a frontmatter zendesk_tickets value to a clean string array.
 * Accepts either an array (the canonical shape) or a single string for
 * tolerance — older notes that started with one ticket may still have
 * the scalar form. Returns undefined when nothing usable is present so
 * downstream consumers can skip the field cleanly.
 */
function normalizeZendeskTickets(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const cleaned = raw
      .map((t) => (t == null ? "" : String(t).trim()))
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  if (typeof raw === "string") {
    const cleaned = raw.trim();
    return cleaned ? [cleaned] : undefined;
  }
  if (typeof raw === "number") {
    return [String(raw)];
  }
  return undefined;
}

export interface CreateProjectInput {
  /** Display name. Used for the H1 + filename. */
  name: string;
  /**
   * Optional explicit slug. When omitted, derived from `name` via the
   * existing slugify helper. Slugs determine both the filename and the
   * URL of the project workbench, so the user typically wants control.
   */
  slug?: string;
  kind: ProjectKind;
  status?: ProjectStatus;
  /** Optional initial body. Defaults to a single H1 derived from name. */
  body?: string;
  /** Frontmatter overrides; merged on top of derived defaults. */
  frontmatter?: Partial<ProjectFrontmatter>;
}

export interface CreateProjectResult {
  slug: string;
  absolute_path: string;
  relative_path: string;
}

/**
 * Create a new project markdown file in `Projects/`. Defaults to the
 * flat-file layout (`Projects/<Display Name>.md`); the folder layout
 * is for projects that grow siblings later. Refuses to overwrite an
 * existing file by either name or slug — caller picks a different
 * slug or edits the existing project.
 *
 * Atomic write: a partial crash mid-write doesn't corrupt the vault.
 */
export async function createProject(
  opts: ResolvedVaultOptions,
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("Project name is required");
  }
  const slug = (input.slug?.trim() || slugify(trimmedName)).trim();
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(
      `Slug "${slug}" must be lowercase alphanumeric + hyphens, starting with a letter or digit`,
    );
  }

  const paths = vaultPaths(opts);
  // Filename uses the display name (Obsidian-friendly); the slug field
  // in frontmatter is what Smithers keys off internally. Strip
  // filesystem-unsafe characters from the display name to avoid path
  // surprises.
  const fileName = `${sanitizeFileName(trimmedName)}.md`;
  const absolutePath = join(paths.projects, fileName);

  // Refuse to overwrite an existing project file (either by display
  // name or by slug — slug collisions cause routing surprises).
  const existingByName = await tryReadFile(absolutePath);
  if (existingByName !== null) {
    throw new Error(
      `A project file already exists at ${relative(opts.vaultPath, absolutePath)}. Pick a different name or edit the existing file.`,
    );
  }
  const existingProjects = await listProjects(opts).catch(() => []);
  if (existingProjects.some((p) => p.slug === slug)) {
    throw new Error(
      `Slug "${slug}" is already used by another project. Pick a different slug.`,
    );
  }

  // Caller frontmatter applies first; identity + locked fields win at
  // the end so a stray override can't break slug/name/kind.
  const frontmatter: ProjectFrontmatter = {
    ...(input.frontmatter ?? {}),
    project_id: newId(),
    slug,
    name: trimmedName,
    kind: input.kind,
    status: input.status ?? input.frontmatter?.status ?? "active",
  };

  const body = input.body ?? `\n\n# ${trimmedName}\n`;
  const content = serializeMarkdown(
    frontmatter as unknown as Record<string, unknown>,
    body,
  );
  await writeFileAtomic(absolutePath, content);

  return {
    slug,
    absolute_path: absolutePath,
    relative_path: relative(opts.vaultPath, absolutePath),
  };
}

export interface AddProjectZendeskTicketResult {
  zendesk_tickets: string[];
  /** True when the ticket was newly added; false when it was a no-op duplicate. */
  added: boolean;
}

/**
 * Append a Zendesk ticket reference to the project's `zendesk_tickets`
 * frontmatter array. Idempotent: if a ticket with the same numeric id is
 * already present (regardless of whether the existing entry is a raw id
 * or a full URL), this is a no-op and `added` is false.
 *
 * The new ref is appended to the *end* of the array — the first entry
 * is treated as the primary thread, so existing primary stays primary.
 */
export async function addProjectZendeskTicket(
  opts: ResolvedVaultOptions,
  slug: string,
  ticketRef: string,
): Promise<AddProjectZendeskTicketResult> {
  const trimmed = ticketRef.trim();
  if (!trimmed) {
    throw new Error("Ticket reference is required");
  }
  const project = await readProject(opts, slug);
  if (!project) {
    throw new Error(`Project "${slug}" not found`);
  }
  if (project.source.kind === "hive-mind") {
    throw new Error(
      `Project "${slug}" lives in Hive Mind; ticket edits go through the shared-notes flow`,
    );
  }
  const path = project.source.absolute_path;
  const raw = await tryReadFile(path);
  if (raw === null) {
    throw new Error(`Project file disappeared at ${path}`);
  }
  const { data, content } = parseMarkdown(raw);

  const existing = normalizeZendeskTickets(data["zendesk_tickets"]) ?? [];
  const newId = extractTicketIdLocal(trimmed);
  const isDuplicate = existing.some((ref) => {
    const refId = extractTicketIdLocal(ref);
    if (newId && refId) return newId === refId;
    return ref === trimmed;
  });
  if (isDuplicate) {
    return { zendesk_tickets: existing, added: false };
  }
  const next = [...existing, trimmed];
  const merged = { ...data, zendesk_tickets: next };
  await writeFileAtomic(path, serializeMarkdown(merged, content));
  return { zendesk_tickets: next, added: true };
}

/**
 * Local copy of the ticket-id extractor — vault package keeps zero
 * dependencies on @smithers/mcp-client to avoid a circular import.
 * Recognizes raw numeric ids and the standard Automattic Zendesk
 * agent-ticket URL shape.
 */
function extractTicketIdLocal(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/\/tickets\/(\d+)\b/);
  return m ? m[1]! : null;
}

/**
 * Strip path-unsafe characters from a display name so it works on
 * macOS / Linux filesystems. Leaves spaces and most punctuation alone
 * because Obsidian-style filenames look like "The Pocket NYC | Phase 2".
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>]/g, "-") // path-illegal characters
    .replace(/\s+/g, " ") // collapse runs of whitespace
    .trim();
}
