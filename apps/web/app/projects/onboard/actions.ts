"use server";

import { revalidatePath } from "next/cache";

import { isGenericSlug, slugify } from "@smithers/vault";

import { getMcpClient } from "@/lib/server/mcp";
import { getVault } from "@/lib/server/vault";

const DEFAULT_OWNER = "katie.mccanna@a8c.com";

/**
 * Create a vault scratchpad for an existing Hive-Mind project so it shows
 * up on the Smithers /projects index. Idempotent — if a vault file with the
 * same name already exists, it's preserved.
 */
export async function importFromHiveMindAction(input: {
  partnerSlug: string;
  projectSlug: string;
  title: string;
  /** Optional Linear slugId pre-matched in the onboarding table by name. */
  linearProjectId?: string;
}): Promise<{ ok: true; created: boolean; relative_path: string } | { ok: false; reason: string }> {
  const partner = input.partnerSlug.trim();
  const project = input.projectSlug.trim();
  const title = input.title.trim();
  if (!partner || !project || !title) {
    return { ok: false, reason: "partnerSlug, projectSlug and title are required" };
  }
  const vault = await getVault();
  try {
    // Prefix with partner when the HM project slug is generic (`phase-2`,
    // `redesign`, etc.). Without this, follow-up matching over-matches every
    // row containing "phase 2" or similar across the vault.
    const titleSlug = slugify(title);
    const projectSlugBare = slugify(project);
    const vaultSlug = isGenericSlug(titleSlug) || isGenericSlug(projectSlugBare)
      ? `${partner}-${projectSlugBare}`
      : titleSlug;
    const result = await vault.createProjectScratchpad({
      name: title,
      slug: vaultSlug,
      kind: "partner",
      partner,
      hive_mind_partner_slug: partner,
      hive_mind_project_slug: project,
      linear_project_id: input.linearProjectId?.trim() || undefined,
    });
    revalidatePath("/projects");
    revalidatePath("/projects/onboard");
    return {
      ok: true,
      created: result.created,
      relative_path: result.relative_path,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to import",
    };
  }
}

/**
 * Bulk import — loops through refs and revalidates once at the end. Returns
 * a per-ref outcome so the UI can flag any that failed.
 */
export async function importFromHiveMindBatchAction(
  refs: {
    partnerSlug: string;
    projectSlug: string;
    title: string;
    linearProjectId?: string;
  }[],
): Promise<{
  results: {
    partnerSlug: string;
    projectSlug: string;
    ok: boolean;
    created?: boolean;
    reason?: string;
  }[];
}> {
  const vault = await getVault();
  const results: {
    partnerSlug: string;
    projectSlug: string;
    ok: boolean;
    created?: boolean;
    reason?: string;
  }[] = [];

  for (const ref of refs) {
    const partner = ref.partnerSlug.trim();
    const project = ref.projectSlug.trim();
    const title = ref.title.trim();
    if (!partner || !project || !title) {
      results.push({
        partnerSlug: partner,
        projectSlug: project,
        ok: false,
        reason: "missing fields",
      });
      continue;
    }
    try {
      const titleSlug = slugify(title);
      const projectSlugBare = slugify(project);
      const vaultSlug = isGenericSlug(titleSlug) || isGenericSlug(projectSlugBare)
        ? `${partner}-${projectSlugBare}`
        : titleSlug;
      const result = await vault.createProjectScratchpad({
        name: title,
        slug: vaultSlug,
        kind: "partner",
        partner,
        hive_mind_partner_slug: partner,
        hive_mind_project_slug: project,
        linear_project_id: ref.linearProjectId?.trim() || undefined,
      });
      results.push({
        partnerSlug: partner,
        projectSlug: project,
        ok: true,
        created: result.created,
      });
    } catch (err) {
      results.push({
        partnerSlug: partner,
        projectSlug: project,
        ok: false,
        reason: err instanceof Error ? err.message : "Failed",
      });
    }
  }

  revalidatePath("/projects");
  revalidatePath("/projects/onboard");
  return { results };
}

/**
 * Sweep vault projects and ensure that any with `hive_mind_partner_slug`
 * also have `kind: partner` set. Heals scratchpads created by an earlier
 * import that didn't stamp `kind`. Same affordance handles TAM-to-TAM
 * handoffs where someone clones the Hive-Mind repo and runs imports
 * against an older Smithers build.
 */
export async function repairKindForHiveMindImportsAction(): Promise<{
  fixed: number;
  scanned: number;
}> {
  const vault = await getVault();
  const projects = await vault.listProjects().catch(() => []);
  let fixed = 0;
  for (const p of projects) {
    if (!p.hive_mind_partner_slug) continue;
    if (p.kind === "partner" || p.kind === "team") continue;
    if (p.source.kind === "hive-mind") continue; // Hive-Mind-sourced projects don't get vault edits
    try {
      await vault.updateProjectFrontmatter(p.slug, { kind: "partner" });
      fixed += 1;
    } catch {
      // Skip and keep going; UI surfaces the count.
    }
  }
  if (fixed > 0) {
    revalidatePath("/projects");
    revalidatePath("/projects/onboard");
  }
  return { fixed, scanned: projects.length };
}

/**
 * Connect a vault project to Hive-Mind: create the partner if it doesn't
 * exist, create the project, then write hive_mind_*_slug back to the vault
 * frontmatter. Reads the vault project for title/description fallbacks.
 */
export async function connectProjectToHiveMindAction(input: {
  vaultSlug: string;
  partnerSlug: string;
  partnerTitle: string;
  partnerDescription: string;
  partnerIsNew: boolean;
  projectSlug: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { vaultSlug, partnerSlug, partnerTitle, partnerDescription, partnerIsNew, projectSlug } =
    input;
  if (!vaultSlug || !partnerSlug || !projectSlug) {
    return { ok: false, reason: "vaultSlug, partnerSlug, projectSlug required" };
  }

  const vault = await getVault();
  const project = await vault.readProject(vaultSlug).catch(() => null);
  if (!project) return { ok: false, reason: "Vault project not found" };

  const mcp = await getMcpClient();
  try {
    if (partnerIsNew) {
      if (!partnerTitle.trim() || !partnerDescription.trim()) {
        return { ok: false, reason: "Partner title and description required for new partner" };
      }
      await mcp.hiveMind.createPartner({
        slug: partnerSlug,
        title: partnerTitle,
        description: partnerDescription,
        owner: DEFAULT_OWNER,
      });
    }
    await mcp.hiveMind.createProject({
      partner: partnerSlug,
      project: projectSlug,
      title: project.name,
      description: project.heading ?? project.name,
      owner: DEFAULT_OWNER,
    });
    await mcp.hiveMind.commit(
      `feat: scaffold ${partnerSlug}/${projectSlug} from Smithers`,
    );
    await vault.updateProjectFrontmatter(vaultSlug, {
      hive_mind_partner_slug: partnerSlug,
      hive_mind_project_slug: projectSlug,
    });
    revalidatePath("/projects");
    revalidatePath("/projects/onboard");
    revalidatePath(`/projects/${vaultSlug}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to connect",
    };
  }
}

/**
 * One-shot "Set up new project" — for Linear projects that don't yet have
 * a Hive-Mind project or a vault scratchpad. Creates the partner if new,
 * the Hive-Mind project, and the vault scratchpad with linear_project_id
 * pre-filled. Used by the Set Up dialog on /projects/onboard.
 */
export async function setupProjectFromLinearAction(input: {
  projectName: string;
  projectSlug: string;
  linearProjectId: string;
  linearProjectSlug?: string;
  partnerSlug: string;
  partnerTitle: string;
  partnerDescription: string;
  partnerIsNew: boolean;
}): Promise<{ ok: true; vault_relative_path: string } | { ok: false; reason: string }> {
  const projectName = input.projectName.trim();
  const projectSlug = input.projectSlug.trim();
  const linearId = input.linearProjectId.trim();
  const partnerSlug = input.partnerSlug.trim();
  if (!projectName || !projectSlug || !linearId || !partnerSlug) {
    return { ok: false, reason: "projectName, projectSlug, linearId, partnerSlug required" };
  }
  if (input.partnerIsNew && (!input.partnerTitle.trim() || !input.partnerDescription.trim())) {
    return { ok: false, reason: "Partner title and description required for new partner" };
  }

  const vault = await getVault();
  const mcp = await getMcpClient();
  try {
    if (input.partnerIsNew) {
      await mcp.hiveMind.createPartner({
        slug: partnerSlug,
        title: input.partnerTitle.trim(),
        description: input.partnerDescription.trim(),
        owner: DEFAULT_OWNER,
      });
    }
    await mcp.hiveMind.createProject({
      partner: partnerSlug,
      project: projectSlug,
      title: projectName,
      description: projectName,
      owner: DEFAULT_OWNER,
    });
    await mcp.hiveMind.commit(
      `feat: scaffold ${partnerSlug}/${projectSlug} from Smithers (Linear)`,
    );
    // Vault slug needs to be distinct from generic HM slugs to avoid
    // follow-up over-matching. HM stays as the user picked.
    const vaultSlug = isGenericSlug(projectSlug)
      ? `${partnerSlug}-${projectSlug}`
      : projectSlug;
    const result = await vault.createProjectScratchpad({
      name: projectName,
      slug: vaultSlug,
      kind: "partner",
      partner: partnerSlug,
      hive_mind_partner_slug: partnerSlug,
      hive_mind_project_slug: projectSlug,
      linear_project_id: linearId,
    });
    revalidatePath("/projects");
    revalidatePath("/projects/onboard");
    return { ok: true, vault_relative_path: result.relative_path };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to set up project",
    };
  }
}
