import matter from "gray-matter";

/**
 * Parse a markdown file into frontmatter + body. Tolerant of files without
 * frontmatter — those return `data: {}` and the original body.
 */
export function parseMarkdown(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  const parsed = matter(raw);
  return { data: { ...parsed.data }, content: parsed.content };
}

/**
 * Serialize frontmatter + body back to a single markdown string.
 *
 * Empty frontmatter writes a plain body (no `---` block) to keep files clean
 * for users who haven't opted into frontmatter yet.
 */
export function serializeMarkdown(
  data: Record<string, unknown>,
  content: string,
): string {
  const cleaned = stripUndefined(data);
  if (Object.keys(cleaned).length === 0) {
    return content.startsWith("\n") ? content.slice(1) : content;
  }
  return matter.stringify(content, cleaned);
}

/**
 * Non-destructive merge: any key already present in `existing` wins. Used
 * when we need to add a generated id to a file without overwriting user fields.
 */
export function mergeFrontmatter(
  existing: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(updates)) {
    if (out[k] === undefined || out[k] === null || out[k] === "") {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Strip `undefined` values from a frontmatter object, recursing into
 * nested objects and arrays. js-yaml's `dump` throws
 *   "unacceptable kind of an object to dump [object Undefined]"
 * on any `undefined` it encounters at any depth — so a top-level-only
 * strip isn't enough once frontmatter starts carrying structured
 * sub-objects (like the call-notes `analysis` block whose
 * follow_ups[].follow_up_by and decisions[].context are optional).
 *
 * Behavior:
 *   - undefined → omitted (the bug fix)
 *   - null → preserved (legitimate "I checked, there's no value here")
 *   - arrays → recurse into each element; undefined elements collapse
 *     to null rather than being dropped, to preserve index identity
 *   - other primitives → returned as-is
 */
function stripUndefined(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = cleanValue(v);
  }
  return out;
}

function cleanValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null) return null;
  if (Array.isArray(v)) return v.map(cleanValue);
  if (typeof v === "object") {
    return stripUndefined(v as Record<string, unknown>);
  }
  return v;
}
