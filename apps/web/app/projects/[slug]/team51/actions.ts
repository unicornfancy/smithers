"use server";

import { revalidatePath } from "next/cache";

import { cancelTeam51Run, startTeam51Run } from "@/lib/server/team51";
import { getVault } from "@/lib/server/vault";

type ActionResult<T = void> = T extends void
  ? { ok: true } | { ok: false; reason: string; message?: string }
  : { ok: true; data: T } | { ok: false; reason: string; message?: string };

/**
 * Kick off `wpcom:create-site`. Smithers passes every arg + option
 * up front so the CLI's interactive prompts never fire. The
 * runtime confirmation dialog (Symfony's "Are you sure?" step)
 * happens in Smithers UI BEFORE this action fires — we don't have
 * a way to pass through that particular prompt because Symfony
 * short-circuits it to `false` under `--no-interaction`.
 */
export async function startWpcomCreateSiteAction(input: {
  project_slug: string;
  name: string;
  repository?: string;
  project_template?: "project" | "no-code-project";
  no_code_theme?: string;
}): Promise<ActionResult<{ run_id: string }>> {
  if (!input.project_slug || !input.name) {
    return { ok: false, reason: "validation", message: "project_slug and name are required" };
  }

  const cleaned = cleanWpcomName(input.name);
  if (!cleaned) {
    return {
      ok: false,
      reason: "validation",
      message: "Site name must contain letters or digits after cleanup.",
    };
  }

  const args: string[] = [cleaned];
  if (input.repository?.trim()) {
    args.push(`--repository=${input.repository.trim()}`);
  }
  if (input.project_template) {
    args.push(`--project-template=${input.project_template}`);
  }
  if (input.no_code_theme?.trim()) {
    args.push(`--no-code-theme=${input.no_code_theme.trim()}`);
  }

  const res = await startTeam51Run({
    project_slug: input.project_slug,
    command: "wpcom:create-site",
    command_group: "wpcom",
    args,
  });

  if (!res.ok) {
    return {
      ok: false,
      reason: res.reason,
      message: res.message,
    };
  }

  revalidatePath(`/projects/${input.project_slug}`);
  return { ok: true, data: { run_id: res.run_id } };
}

/**
 * WPCOM site names have to be lowercase alphanumeric — the CLI
 * strips dashes and slugifies. Match the CLI's rule here so the
 * Smithers form preview matches what actually lands.
 *
 * See ~/team51-cli/commands/WPCOM_Site_Create.php line 81:
 *   `str_replace('-', '', slugify($input))`.
 */
export function cleanWpcomName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    // Drop combining marks
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

export async function cancelTeam51RunAction(input: {
  run_id: string;
  project_slug: string;
}): Promise<ActionResult> {
  const ok = await cancelTeam51Run(input.run_id);
  if (!ok) return { ok: false, reason: "not-cancellable" };
  revalidatePath(`/projects/${input.project_slug}/team51/${input.run_id}`);
  return { ok: true };
}

/**
 * Suggest the WPCOM site name from the vault's project name. Used
 * to pre-fill the form. Ships as a server action so the cleanup
 * logic stays server-side and callers don't need to reimplement it.
 */
export async function suggestWpcomNameAction(projectSlug: string): Promise<{
  suggestion: string;
  raw_project_name: string | null;
}> {
  const vault = await getVault();
  const project = await vault.readProject(projectSlug).catch(() => null);
  const raw = project?.name ?? "";
  return { suggestion: cleanWpcomName(raw), raw_project_name: raw || null };
}
