import type { ResolvedVaultOptions } from "./config";
import { parseMarkdown, serializeMarkdown } from "./frontmatter";
import { tryReadFile, writeFileAtomic } from "./fs";
import { deterministicId } from "./ids";
import { readProject } from "./projects";

export interface ProjectTask {
  /** Stable id derived from the line content + section. */
  task_id: string;
  text: string;
  done: boolean;
  /** 1-based line number in the source body. */
  line_number: number;
  /** Closest preceding `## ` or `### ` heading, when present. */
  section?: string;
  /** Indentation depth in spaces (used for nested bullets). */
  indent: number;
  /** Optional priority tag parsed from trailing `[high]`/`[medium]`/`[low]`. */
  priority?: "high" | "medium" | "low";
  /** Optional ISO due date parsed from trailing `[YYYY-MM-DD]`. */
  due_date?: string;
}

const TASK_RE = /^(?<indent>\s*)[-*+]\s+\[(?<state> |x|X)\]\s+(?<text>.+?)\s*$/;
const HEADING_RE = /^(?<hashes>#{2,4})\s+(?<text>.+?)\s*$/;

const PRIORITY_RE = /\[(high|medium|low)\]/i;
const DUE_DATE_RE = /\[(\d{4}-\d{2}-\d{2})\]/;

/**
 * Strip priority and due-date markers from the end of a raw task text string.
 * Returns clean display text plus the extracted fields.
 *
 * Markers are always in brackets: `[high]`, `[medium]`, `[low]`, `[YYYY-MM-DD]`.
 * Order doesn't matter; both are optional. The clean text is used for
 * task_id hashing so ids are stable regardless of which markers are present.
 */
export function parseTaskMarkers(rawText: string): {
  text: string;
  priority?: "high" | "medium" | "low";
  due_date?: string;
} {
  let text = rawText;
  let priority: "high" | "medium" | "low" | undefined;
  let due_date: string | undefined;

  const priorityMatch = text.match(PRIORITY_RE);
  if (priorityMatch) {
    priority = priorityMatch[1]!.toLowerCase() as "high" | "medium" | "low";
    text = text.replace(PRIORITY_RE, "").trim();
  }

  const dateMatch = text.match(DUE_DATE_RE);
  if (dateMatch) {
    due_date = dateMatch[1]!;
    text = text.replace(DUE_DATE_RE, "").trim();
  }

  return { text, priority, due_date };
}

/** Serialize priority and/or due_date back to inline marker strings. */
function serializeMarkers(
  priority?: "high" | "medium" | "low",
  due_date?: string,
): string {
  const parts: string[] = [];
  if (priority) parts.push(`[${priority}]`);
  if (due_date) parts.push(`[${due_date}]`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/**
 * Extract checkbox tasks from a markdown body.
 *
 * Recognizes `- [ ]`, `- [x]`, `* [ ]`, `+ [ ]`, with any leading indentation.
 * Tracks the most recent `##`/`###`/`####` heading so each task carries its
 * containing section — useful for grouping in the workbench UI.
 */
export function parseProjectTasks(body: string): ProjectTask[] {
  const lines = body.split(/\r?\n/);
  const out: ProjectTask[] = [];
  let section: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = line.match(HEADING_RE);
    if (heading?.groups) {
      section = heading.groups["text"];
      continue;
    }
    const task = line.match(TASK_RE);
    if (task?.groups) {
      const rawText = task.groups["text"]!;
      const done = task.groups["state"]!.toLowerCase() === "x";
      const indent = task.groups["indent"]?.length ?? 0;
      const { text, priority, due_date } = parseTaskMarkers(rawText);
      out.push({
        task_id: deterministicId(section ?? "", text, String(i)),
        text,
        done,
        line_number: i + 1,
        section,
        indent,
        ...(priority !== undefined ? { priority } : {}),
        ...(due_date !== undefined ? { due_date } : {}),
      });
    }
  }
  return out;
}

/**
 * Convenience splitter: open vs done. Many UI views show open items first
 * with a small "show completed" disclosure for done ones.
 */
export function splitTasks(tasks: ProjectTask[]): {
  open: ProjectTask[];
  done: ProjectTask[];
} {
  return {
    open: tasks.filter((t) => !t.done),
    done: tasks.filter((t) => t.done),
  };
}

export interface ToggleProjectTaskResult {
  task_id: string;
  done: boolean;
  line_number: number;
}

/**
 * Flip a single checkbox task in a project's markdown body. We re-parse the
 * file at toggle time so a stale `task_id` from the UI (the file may have
 * grown new lines since render) still resolves — the id is content-derived,
 * not position-derived, so it survives unrelated edits.
 *
 * Throws if the project or task can't be located so the caller (server
 * action) can surface a user-visible error instead of silently no-op-ing.
 */
export async function toggleProjectTask(
  opts: ResolvedVaultOptions,
  slug: string,
  taskId: string,
  done: boolean,
): Promise<ToggleProjectTaskResult> {
  const project = await readProject(opts, slug);
  if (!project) {
    throw new Error(`Project "${slug}" not found`);
  }
  if (project.source.kind === "hive-mind") {
    throw new Error(
      `Project "${slug}" lives in Hive Mind; task edits go through the shared-notes flow`,
    );
  }
  const path = project.source.absolute_path;
  const raw = await tryReadFile(path);
  if (raw === null) {
    throw new Error(`Project file disappeared at ${path}`);
  }

  const { data, content } = parseMarkdown(raw);
  const tasks = parseProjectTasks(content);
  const target = tasks.find((t) => t.task_id === taskId);
  if (!target) {
    throw new Error(
      `Task ${taskId} no longer present in ${slug} — file may have changed`,
    );
  }

  const lines = content.split(/\r?\n/);
  const idx = target.line_number - 1;
  const line = lines[idx];
  if (line === undefined) {
    throw new Error(
      `Line ${target.line_number} out of bounds in ${slug} body`,
    );
  }
  const updated = line.replace(
    /^(\s*[-*+]\s+\[)( |x|X)(\]\s+)/,
    (_m, pre: string, _state: string, post: string) =>
      `${pre}${done ? "x" : " "}${post}`,
  );
  if (updated === line) {
    // No regex match — unlikely since parseProjectTasks already matched, but
    // guard so we don't write an unchanged file and bump mtime for nothing.
    return { task_id: target.task_id, done: target.done, line_number: target.line_number };
  }
  lines[idx] = updated;

  const newContent = lines.join("\n");
  await writeFileAtomic(path, serializeMarkdown(data, newContent));

  return { task_id: target.task_id, done, line_number: target.line_number };
}

export interface AppendProjectTaskResult {
  task_id: string;
  text: string;
  line_number: number;
}

/**
 * Append a new `- [ ] <text>` line to a project's markdown body. Inserts
 * directly after the last existing task line so additions stay grouped
 * with the existing checklist; if the body has no tasks yet, appends at
 * the end with a trailing blank line.
 *
 * Section-aware insertion (e.g. always under `## Open items`) is left for
 * a later slice — for now the user gets predictable "added at the bottom
 * of the existing list" behavior, which matches how todo lists usually grow.
 */
export async function appendProjectTask(
  opts: ResolvedVaultOptions,
  slug: string,
  text: string,
  markers?: { priority?: "high" | "medium" | "low"; due_date?: string },
): Promise<AppendProjectTaskResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Task text is required");
  }
  const project = await readProject(opts, slug);
  if (!project) {
    throw new Error(`Project "${slug}" not found`);
  }
  if (project.source.kind === "hive-mind") {
    throw new Error(
      `Project "${slug}" lives in Hive Mind; task edits go through the shared-notes flow`,
    );
  }
  const path = project.source.absolute_path;
  const raw = await tryReadFile(path);
  if (raw === null) {
    throw new Error(`Project file disappeared at ${path}`);
  }

  const { data, content } = parseMarkdown(raw);
  const lines = content.split(/\r?\n/);
  const newLine = `- [ ] ${trimmed}${serializeMarkers(markers?.priority, markers?.due_date)}`;

  let insertedLineIndex: number;
  // Walk backwards to find the last task line; insert right after it.
  let lastTaskIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (TASK_RE.test(lines[i]!)) {
      lastTaskIdx = i;
      break;
    }
  }
  if (lastTaskIdx >= 0) {
    lines.splice(lastTaskIdx + 1, 0, newLine);
    insertedLineIndex = lastTaskIdx + 1;
  } else {
    // No tasks yet — drop trailing blanks so we don't grow whitespace,
    // then append the line + a single trailing newline for cleanliness.
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    lines.push(newLine);
    insertedLineIndex = lines.length - 1;
    lines.push("");
  }

  const newContent = lines.join("\n");
  await writeFileAtomic(path, serializeMarkdown(data, newContent));

  // Look up the freshly-created task by its line number so we can return
  // its real task_id (deterministicId depends on section + index, which we
  // don't know without re-parsing).
  const reparsed = parseProjectTasks(newContent);
  const inserted = reparsed.find(
    (t) => t.line_number === insertedLineIndex + 1,
  );
  if (!inserted) {
    throw new Error("internal: failed to locate appended task after write");
  }

  return {
    task_id: inserted.task_id,
    text: inserted.text,
    line_number: inserted.line_number,
  };
}

export interface EditProjectTaskTextResult {
  /** New task_id — the deterministic id is text-derived, so it changes. */
  task_id: string;
  text: string;
  line_number: number;
}

/**
 * Replace the text portion of a single task line, preserving the line's
 * indent, bullet character, and checkbox state. The `task_id` changes as
 * a result (the deterministic id hashes the text), so callers should use
 * the returned id when keying UI rows.
 *
 * No-op + early return if the trimmed new text matches the existing text,
 * so a blur-without-changes doesn't bump the file mtime.
 */
export async function editProjectTaskText(
  opts: ResolvedVaultOptions,
  slug: string,
  taskId: string,
  newText: string,
): Promise<EditProjectTaskTextResult> {
  const trimmed = newText.trim();
  if (!trimmed) {
    throw new Error("Task text is required");
  }
  const project = await readProject(opts, slug);
  if (!project) {
    throw new Error(`Project "${slug}" not found`);
  }
  if (project.source.kind === "hive-mind") {
    throw new Error(
      `Project "${slug}" lives in Hive Mind; task edits go through the shared-notes flow`,
    );
  }
  const path = project.source.absolute_path;
  const raw = await tryReadFile(path);
  if (raw === null) {
    throw new Error(`Project file disappeared at ${path}`);
  }

  const { data, content } = parseMarkdown(raw);
  const tasks = parseProjectTasks(content);
  const target = tasks.find((t) => t.task_id === taskId);
  if (!target) {
    throw new Error(
      `Task ${taskId} no longer present in ${slug} — file may have changed`,
    );
  }
  if (target.text === trimmed) {
    return {
      task_id: target.task_id,
      text: target.text,
      line_number: target.line_number,
    };
  }

  const lines = content.split(/\r?\n/);
  const idx = target.line_number - 1;
  const line = lines[idx];
  if (line === undefined) {
    throw new Error(
      `Line ${target.line_number} out of bounds in ${slug} body`,
    );
  }
  // Capture indent + bullet + checkbox state, swap the text after the
  // closing `]`, preserving any priority/due-date markers that were on
  // the original line.
  const markerSuffix = serializeMarkers(target.priority, target.due_date);
  const updated = line.replace(
    /^(\s*[-*+]\s+\[(?: |x|X)\]\s+).+?\s*$/,
    (_m, prefix: string) => `${prefix}${trimmed}${markerSuffix}`,
  );
  if (updated === line) {
    throw new Error(
      `Could not match task line shape for ${slug} task ${taskId}`,
    );
  }
  lines[idx] = updated;

  const newContent = lines.join("\n");
  await writeFileAtomic(path, serializeMarkdown(data, newContent));

  const reparsed = parseProjectTasks(newContent);
  const updatedTask = reparsed.find(
    (t) => t.line_number === target.line_number,
  );
  if (!updatedTask) {
    throw new Error("internal: failed to locate task after edit");
  }
  return {
    task_id: updatedTask.task_id,
    text: updatedTask.text,
    line_number: updatedTask.line_number,
  };
}

export interface DeleteProjectTaskResult {
  task_id: string;
  text: string;
  line_number: number;
}

/**
 * Remove a single task line from a project body. Splices just the matched
 * line — section headings, surrounding blanks, and other content stay put
 * (heuristic clean-up of empty sections is brittle and the user can tidy
 * up by hand if needed).
 *
 * Returns the deleted task's metadata so callers can offer an undo / log
 * entry without having to hold the data themselves.
 */
export async function deleteProjectTask(
  opts: ResolvedVaultOptions,
  slug: string,
  taskId: string,
): Promise<DeleteProjectTaskResult> {
  const project = await readProject(opts, slug);
  if (!project) {
    throw new Error(`Project "${slug}" not found`);
  }
  if (project.source.kind === "hive-mind") {
    throw new Error(
      `Project "${slug}" lives in Hive Mind; task edits go through the shared-notes flow`,
    );
  }
  const path = project.source.absolute_path;
  const raw = await tryReadFile(path);
  if (raw === null) {
    throw new Error(`Project file disappeared at ${path}`);
  }

  const { data, content } = parseMarkdown(raw);
  const tasks = parseProjectTasks(content);
  const target = tasks.find((t) => t.task_id === taskId);
  if (!target) {
    throw new Error(
      `Task ${taskId} no longer present in ${slug} — file may have changed`,
    );
  }

  const lines = content.split(/\r?\n/);
  const idx = target.line_number - 1;
  if (idx < 0 || idx >= lines.length) {
    throw new Error(
      `Line ${target.line_number} out of bounds in ${slug} body`,
    );
  }
  lines.splice(idx, 1);

  const newContent = lines.join("\n");
  await writeFileAtomic(path, serializeMarkdown(data, newContent));

  return {
    task_id: target.task_id,
    text: target.text,
    line_number: target.line_number,
  };
}
