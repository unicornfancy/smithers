"use server";

import { revalidatePath } from "next/cache";

import { cleanPressableName, cleanWpcomName } from "@/lib/team51-names";
import {
  cancelTeam51Run,
  startTeam51Run,
  type Team51CommandSlug,
} from "@/lib/server/team51";
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
    // wpcom:create-site pushes generated credentials into 1Password
    // (via `op`) and — when a repository option is set — touches
    // GitHub via `gh`. Both need to be authenticated in the env
    // Smithers spawned into. Pre-flight catches expired sessions
    // before we run a destructive command.
    required_tools: input.repository?.trim() ? ["op", "gh"] : ["op"],
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

// ---------------------------------------------------------------------------
// pressable:create-site
// ---------------------------------------------------------------------------

/**
 * Kick off `pressable:create-site`. Same shape as the WPCOM
 * equivalent but with an extra datacenter option and dashes
 * allowed in the site name (see `cleanPressableName` in
 * `lib/team51-names.ts`).
 */
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
    required_tools: input.repository?.trim() ? ["op", "gh"] : ["op"],
  });

  if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
  revalidatePath(`/projects/${input.project_slug}`);
  return { ok: true, data: { run_id: res.run_id } };
}

// ---------------------------------------------------------------------------
// pressable:clone-site  (launch-day workflow)
// ---------------------------------------------------------------------------

/**
 * Clone a Pressable site. Target arg accepts either a domain or a
 * numeric Pressable ID; both are what the CLI passes straight to
 * the Pressable API. Label defaults to `development` server-side
 * — Smithers just doesn't send it when unset.
 */
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
    // Cloning triggers a fresh admin password → 1Password write.
    required_tools: ["op"],
  });

  if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
  revalidatePath(`/projects/${input.project_slug}`);
  return { ok: true, data: { run_id: res.run_id } };
}

// ---------------------------------------------------------------------------
// wp-cli command runners (WPCOM + Pressable variants)
// ---------------------------------------------------------------------------

/**
 * Both CLI subcommands accept a WP-CLI command string. The WPCOM
 * variant takes `<site> <command>` while the Pressable variant
 * takes `<command> [site]` — the arg order is baked into each
 * command's configure().
 */
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
  // Basic guard against obviously destructive commands the user
  // may have typed by mistake. Not a real allowlist — just a
  // tripwire for `db reset`, `plugin uninstall --all`, etc.
  if (/\bdb\s+(reset|drop)|--allow-root/i.test(cmd)) {
    return {
      ok: false,
      reason: "validation",
      message:
        "That WP-CLI command looks destructive. If you're sure, run it in a terminal instead of Smithers.",
    };
  }

  const command: Team51CommandSlug =
    input.platform === "wpcom"
      ? "wpcom:run-site-wp-cli-command"
      : "pressable:run-site-wp-cli-command";
  const args =
    input.platform === "wpcom"
      ? [site, cmd]
      : [cmd, site];
  if (input.skip_output) args.push("--skip-output");

  const res = await startTeam51Run({
    project_slug: input.project_slug,
    command,
    command_group: input.platform,
    args,
    // WP-CLI runs use existing site infrastructure — no new
    // credentials created — so `op` isn't required. gh isn't
    // touched either.
    required_tools: [],
  });

  if (!res.ok) return { ok: false, reason: res.reason, message: res.message };
  revalidatePath(`/projects/${input.project_slug}`);
  return { ok: true, data: { run_id: res.run_id } };
}
