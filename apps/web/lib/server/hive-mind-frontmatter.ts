import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import matter from "gray-matter";

/**
 * Build an updated partner-knowledge.md content string with the given
 * frontmatter patch applied. Doesn't write to disk — caller passes
 * the result to `mcp.hiveMind.writePartnerFile`.
 *
 * `updateProjectInfo` exists as a direct MCP tool for info.md, but
 * partner-knowledge.md has no equivalent, so Smithers does the
 * read-modify-build in JS and writes via the generic writePartnerFile.
 *
 * Semantics match `updateProjectFrontmatter` in the vault package:
 * empty string clears the key; `undefined` leaves it alone.
 */
export async function buildPartnerKnowledgeFrontmatterUpdate(
  hiveMindPath: string,
  partnerSlug: string,
  patch: Record<string, string | undefined>,
): Promise<{ content: string; changed: boolean } | null> {
  const path = join(
    hiveMindPath,
    "knowledge",
    "partners",
    partnerSlug,
    "partner-knowledge.md",
  );
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return null;
  }
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed === "") {
      if (key in data) {
        delete data[key];
        changed = true;
      }
    } else if (data[key] !== trimmed) {
      data[key] = trimmed;
      changed = true;
    }
  }
  if (!changed) {
    return { content: raw, changed: false };
  }
  return { content: matter.stringify(parsed.content, data), changed: true };
}
