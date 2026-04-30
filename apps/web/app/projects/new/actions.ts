"use server";

import { revalidatePath } from "next/cache";

import {
  buildProjectFrontmatterFromForm,
  type CreateProjectFormInput,
} from "@/lib/server/project-create";
import { getVault } from "@/lib/server/vault";

export interface CreateProjectActionResult {
  ok: boolean;
  /** Slug to redirect to on success. */
  slug?: string;
  /** Resolved on-disk path so the UI can show "Wrote to: ..." after. */
  path?: string;
  error?: string;
}

/**
 * Server action wrapping vault.createProject. The form is the only
 * caller today, but the same shape will be reused by the future
 * Linear-driven auto-create flow — same input contract, same output.
 */
export async function createProjectAction(
  input: CreateProjectFormInput,
): Promise<CreateProjectActionResult> {
  if (!input.name?.trim()) {
    return { ok: false, error: "Project name is required" };
  }
  if (input.kind === "partner" && !input.partner_slug?.trim()) {
    return {
      ok: false,
      error:
        "Partner slug is required for kind=partner — it's the directory name in Hive Mind.",
    };
  }
  const vault = await getVault();
  if (!vault.status().exists) {
    return {
      ok: false,
      error:
        "Vault not configured. Set paths.vault in config and restart pnpm dev.",
    };
  }

  const frontmatter = buildProjectFrontmatterFromForm(input);
  try {
    const result = await vault.createProject({
      name: input.name,
      slug: input.slug,
      kind: input.kind,
      status: input.status,
      frontmatter,
    });
    revalidatePath("/projects");
    revalidatePath("/today");
    revalidatePath("/settings");
    return { ok: true, slug: result.slug, path: result.absolute_path };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
