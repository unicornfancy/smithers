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
}

const TASK_RE = /^(?<indent>\s*)[-*+]\s+\[(?<state> |x|X)\]\s+(?<text>.+?)\s*$/;
const HEADING_RE = /^(?<hashes>#{2,4})\s+(?<text>.+?)\s*$/;

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
      const text = task.groups["text"]!;
      const done = task.groups["state"]!.toLowerCase() === "x";
      const indent = task.groups["indent"]?.length ?? 0;
      out.push({
        task_id: deterministicId(section ?? "", text, String(i)),
        text,
        done,
        line_number: i + 1,
        section,
        indent,
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
