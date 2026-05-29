"use server";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import matter from "gray-matter";
import { revalidatePath } from "next/cache";

import { loadConfig } from "@/lib/server/config";
import { getMcpClient } from "@/lib/server/mcp";

interface PartnerKnowledgeFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Load partner-knowledge.md for editing. Returns the raw frontmatter
 * (preserved verbatim across the round trip — we don't normalize or
 * drop unknown fields) and the markdown body. Returns null when the
 * file doesn't exist; the editor renders a "this file is empty"
 * scaffold in that case.
 */
export async function loadPartnerKnowledgeAction(
  partnerSlug: string,
): Promise<
  | { ok: true; data: PartnerKnowledgeFile | null }
  | { ok: false; reason: string }
> {
  if (!partnerSlug) return { ok: false, reason: "partnerSlug is required" };
  const cfg = await loadConfig();
  if (!cfg.paths.hive_mind) {
    return { ok: false, reason: "hive_mind path not set" };
  }
  const absPath = join(
    cfg.paths.hive_mind,
    "knowledge/partners",
    partnerSlug,
    "partner-knowledge.md",
  );
  try {
    const raw = await readFile(absPath, "utf-8");
    const parsed = matter(raw);
    return {
      ok: true,
      data: {
        frontmatter: (parsed.data ?? {}) as Record<string, unknown>,
        body: parsed.content,
      },
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, data: null };
    }
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Read failed",
    };
  }
}

/**
 * Save edits to partner-knowledge.md. Preserves the existing
 * frontmatter verbatim, replaces the body with the user's edit, and
 * stamps the frontmatter `updated` field with today's date — matching
 * the /update-knowledge skill's behavior. Writes via HM MCP and
 * commits.
 *
 * Pass `frontmatter` to also patch named fields; pass undefined to
 * leave the existing frontmatter alone aside from the `updated` stamp.
 */
export async function savePartnerKnowledgeAction(input: {
  partnerSlug: string;
  body: string;
  frontmatter?: Record<string, unknown>;
}): Promise<{ ok: true; relative_path: string } | { ok: false; reason: string }> {
  if (!input.partnerSlug) return { ok: false, reason: "partnerSlug is required" };
  if (!input.body.trim()) return { ok: false, reason: "body is required" };

  const cfg = await loadConfig();
  if (!cfg.paths.hive_mind) {
    return { ok: false, reason: "hive_mind path not set" };
  }

  // Read existing to preserve any frontmatter fields the caller didn't
  // explicitly patch. Mirrors the /update-knowledge skill's promise
  // ("don't remove fields the user didn't ask to change").
  const existingPath = join(
    cfg.paths.hive_mind,
    "knowledge/partners",
    input.partnerSlug,
    "partner-knowledge.md",
  );
  let existingFm: Record<string, unknown> = {};
  try {
    const raw = await readFile(existingPath, "utf-8");
    existingFm = (matter(raw).data ?? {}) as Record<string, unknown>;
  } catch {
    // File may not exist yet — that's fine.
  }

  const merged: Record<string, unknown> = {
    ...existingFm,
    ...(input.frontmatter ?? {}),
    updated: new Date().toISOString().slice(0, 10),
  };

  const serialized = matter.stringify(input.body, merged);

  try {
    const mcp = await getMcpClient();
    await mcp.hiveMind.writePartnerFile(
      input.partnerSlug,
      "partner-knowledge.md",
      serialized,
    );
    await mcp.hiveMind.commit(
      `partner-knowledge: update via Smithers for ${input.partnerSlug}`,
    );
    revalidatePath(`/partner-knowledge/${input.partnerSlug}`);
    revalidatePath("/projects/[slug]", "page");
    return {
      ok: true,
      relative_path: `knowledge/partners/${input.partnerSlug}/partner-knowledge.md`,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "HM write failed",
    };
  }
}
