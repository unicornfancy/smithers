"use server";

import { revalidatePath } from "next/cache";

import { cleanPressableName, cleanWpcomName } from "@/lib/team51-names";
import {
  startTeam51Run,
  writeBackCapturedUrl,
  type Team51CommandSlug,
} from "@/lib/server/team51";
import { getVault } from "@/lib/server/vault";

type ActionResult<T = void> = T extends void
  ? { ok: true } | { ok: false; reason: string; message?: string }
  : { ok: true; data: T } | { ok: false; reason: string; message?: string };

// ---------------------------------------------------------------------------
// wpcom:create-site
// ---------------------------------------------------------------------------

/**
 * Kick off `wpcom:create-site`. Symfony command reference:
 * ~/team51-cli/commands/WPCOM_Site_Create.php. Args mirror what the
 * CLI declares. Smithers doesn't pass `--no-interaction` — the CLI's
 * confirmation prompt fires naturally in the Terminal window that
 * gets opened.
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
  if (input.repository?.trim()) args.push(`--repository=${input.repository.trim()}`);
  if (input.project_template) args.push(`--project-template=${input.project_template}`);
  if (input.no_code_theme?.trim()) args.push(`--no-code-theme=${input.no_code_theme.trim()}`);

  const res = await startTeam51Run({
    project_slug: input.project_slug,
    command: "wpcom:create-site",
    command_group: "wpcom",
    args,
  });

  if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
  revalidatePath(`/projects/${input.project_slug}`);
  return { ok: true, data: { run_id: res.run_id } };
}

export async function suggestWpcomNameAction(projectSlug: string): Promise<{
  suggestion: string;
  raw_project_name: string | null;
}> {
  const vault = await getVault();
  const project = await vault.readProject(projectSlug).catch(() => null);
  const raw = project?.name ?? "";
  return { suggestion: cleanWpcomName(raw), raw_project_name: raw || null };
}

// ---------------------------------------------------------------------------
// pressable:create-site
// ---------------------------------------------------------------------------

export async function startPressableCreateSiteAction(input: {
  project_slug: string;
  name: string;
  datacenter?: string;
  repository?: string;
  project_template?: "project" | "no-code-project";
  no_code_theme?: string;
}): Promise<ActionResult<{ run_id: string }>> {
  if (!input.project_slug || !input.name) {
    return { ok: false, reason: "validation", message: "project_slug and name are required" };
  }
  const cleaned = cleanPressableName(input.name);
  if (cleaned.length < 3) {
    return {
      ok: false,
      reason: "validation",
      message: "Site name must contain at least 3 letters or digits after cleanup.",
    };
  }

  const args: string[] = [cleaned];
  if (input.datacenter?.trim()) args.push(`--datacenter=${input.datacenter.trim()}`);
  if (input.repository?.trim()) args.push(`--repository=${input.repository.trim()}`);
  if (input.project_template) args.push(`--project-template=${input.project_template}`);
  if (input.no_code_theme?.trim()) args.push(`--no-code-theme=${input.no_code_theme.trim()}`);

  const res = await startTeam51Run({
    project_slug: input.project_slug,
    command: "pressable:create-site",
    command_group: "pressable",
    args,
  });

  if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
  revalidatePath(`/projects/${input.project_slug}`);
  return { ok: true, data: { run_id: res.run_id } };
}

// ---------------------------------------------------------------------------
// pressable:clone-site
// ---------------------------------------------------------------------------

export async function startPressableCloneSiteAction(input: {
  project_slug: string;
  source_site: string;
  label?: string;
  datacenter?: string;
  branch?: string;
  skip_safety_net?: boolean;
}): Promise<ActionResult<{ run_id: string }>> {
  if (!input.project_slug || !input.source_site.trim()) {
    return {
      ok: false,
      reason: "validation",
      message: "project_slug and source_site are required",
    };
  }

  const args: string[] = [input.source_site.trim()];
  if (input.label?.trim()) args.push(input.label.trim());
  if (input.datacenter?.trim()) args.push(`--datacenter=${input.datacenter.trim()}`);
  if (input.branch?.trim()) args.push(`--branch=${input.branch.trim()}`);
  if (input.skip_safety_net) args.push("--skip-safety-net");

  const res = await startTeam51Run({
    project_slug: input.project_slug,
    command: "pressable:clone-site",
    command_group: "pressable",
    args,
  });

  if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
  revalidatePath(`/projects/${input.project_slug}`);
  return { ok: true, data: { run_id: res.run_id } };
}

// ---------------------------------------------------------------------------
// wp-cli runners
// ---------------------------------------------------------------------------

export async function startRunWpCliCommandAction(input: {
  project_slug: string;
  platform: "wpcom" | "pressable";
  site: string;
  wp_cli_command: string;
  skip_output?: boolean;
}): Promise<ActionResult<{ run_id: string }>> {
  const site = input.site.trim();
  const cmd = input.wp_cli_command.trim();
  if (!input.project_slug || !site || !cmd) {
    return {
      ok: false,
      reason: "validation",
      message: "project_slug, site, and wp_cli_command are required",
    };
  }
  if (/\bdb\s+(reset|drop)|--allow-root/i.test(cmd)) {
    return {
      ok: false,
      reason: "validation",
      message:
        "That WP-CLI command looks destructive. If you're sure, run it in a terminal directly.",
    };
  }

  const command: Team51CommandSlug =
    input.platform === "wpcom"
      ? "wpcom:run-site-wp-cli-command"
      : "pressable:run-site-wp-cli-command";
  const args =
    input.platform === "wpcom" ? [site, cmd] : [cmd, site];
  if (input.skip_output) args.push("--skip-output");

  const res = await startTeam51Run({
    project_slug: input.project_slug,
    command,
    command_group: input.platform,
    args,
  });

  if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
  revalidatePath(`/projects/${input.project_slug}`);
  return { ok: true, data: { run_id: res.run_id } };
}

// ---------------------------------------------------------------------------
// Post-success frontmatter write-back
// ---------------------------------------------------------------------------

/**
 * User-triggered on the detail page: take the URL parsed from the
 * completed run and write it into the project's frontmatter. Which
 * field depends on the command — see `writeBackCapturedUrl` in
 * team51.ts. Idempotent: no-op if the URL is already set.
 */
export async function writeCapturedUrlToFrontmatterAction(input: {
  run_id: string;
}): Promise<
  | { ok: true; data: { field: string; url: string } }
  | { ok: false; reason: string; message: string }
> {
  if (!input.run_id) {
    return { ok: false, reason: "validation", message: "run_id is required" };
  }
  const result = await writeBackCapturedUrl(input.run_id);
  if (!result.written) {
    return {
      ok: false,
      reason: "not-written",
      message: result.message ?? "Nothing to write",
    };
  }
  return {
    ok: true,
    data: { field: result.field!, url: result.url! },
  };
}
