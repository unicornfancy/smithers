import { deterministicId } from "./ids";

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
