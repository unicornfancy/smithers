import "server-only";

import type { Project } from "@smithers/vault";

import {
  hiveMindAvailable,
  hiveMindPartnerExists,
  hiveMindPartnerPath,
  listHiveMindPartners,
  readHiveMindPartnerTemplate,
  writeHiveMindPartnerKnowledge,
  type HiveMindPartnerSummary,
} from "./hive-mind-fs";
import { getVault } from "./vault";

export interface VaultPartnerProject {
  /** Same project_id from vault. */
  project_id: string;
  /** kebab-case slug — Hive Mind directory uses this verbatim. */
  partner_slug: string;
  /** Human display name; from project.name if no better source. */
  display_name: string;
  /** Vault project the partner is referenced from. */
  project: Project;
  /** True when a Hive Mind partner-knowledge.md exists for this slug. */
  hive_mind_present: boolean;
}

export interface ReconcileSummary {
  /** Path to the configured Hive Mind clone (or null when not set). */
  hive_mind_path: string | null;
  /** Whether the path actually exists on disk. */
  hive_mind_available: boolean;
  /** Reason hive_mind_available is false, when applicable. */
  hive_mind_unavailable_reason?: string;
  /** Vault projects with kind: partner, in vault order. */
  vault_partners: VaultPartnerProject[];
  /** All partner directories in Hive Mind. Read-only reference. */
  hive_mind_partners: HiveMindPartnerSummary[];
}

export interface PreviewResult {
  ok: true;
  partner_slug: string;
  /** Generated content for partner-knowledge.md. */
  content: string;
  /** Where the file would be written. */
  target_path: string;
  /** Whether an entry already exists (apply will refuse). */
  already_exists: boolean;
}

export interface PreviewError {
  ok: false;
  error: string;
}

/**
 * Walk the vault for partner-kind projects, then check Hive Mind for
 * each. The result drives the settings UI: gaps surface a "Create"
 * button, in-sync rows surface a green check.
 */
export async function buildReconcileSummary(): Promise<ReconcileSummary> {
  const status = await hiveMindAvailable();
  const vault = await getVault();
  const allProjects = await vault.listProjects().catch(() => []);

  // Partner-kind projects only. They drive the reconcile flow; team /
  // personal kinds never write to Hive Mind.
  const vaultPartners: VaultPartnerProject[] = [];
  for (const p of allProjects) {
    if (p.kind !== "partner") continue;
    const slug = p.partner ?? p.slug;
    const exists = status.available
      ? await hiveMindPartnerExists(slug)
      : false;
    vaultPartners.push({
      project_id: p.project_id,
      partner_slug: slug,
      display_name: derivePartnerDisplayName(p.name, slug),
      project: p,
      hive_mind_present: exists,
    });
  }

  const hiveMindPartners = status.available
    ? await listHiveMindPartners()
    : [];

  return {
    hive_mind_path: status.path,
    hive_mind_available: status.available,
    hive_mind_unavailable_reason: status.reason,
    vault_partners: vaultPartners,
    hive_mind_partners: hiveMindPartners,
  };
}

/**
 * Generate a partner-knowledge.md preview for a vault project. Pulls
 * the live template from the user's Hive Mind clone so we always
 * match whatever the team's currently using; falls back to a
 * built-in template only when the clone doesn't have one.
 */
export async function previewHiveMindEntry(
  partnerSlug: string,
): Promise<PreviewResult | PreviewError> {
  const summary = await buildReconcileSummary();
  if (!summary.hive_mind_available) {
    return {
      ok: false,
      error:
        summary.hive_mind_unavailable_reason ??
        "Hive Mind clone is not available.",
    };
  }
  const target = summary.vault_partners.find(
    (p) => p.partner_slug === partnerSlug,
  );
  if (!target) {
    return {
      ok: false,
      error: `No partner-kind vault project with partner: ${partnerSlug}.`,
    };
  }

  const template =
    (await readHiveMindPartnerTemplate()) ?? FALLBACK_TEMPLATE;

  const content = renderPartnerKnowledge(template, target);
  const path = await hiveMindPartnerPath(partnerSlug);
  if (!path) {
    return { ok: false, error: "Could not resolve Hive Mind path." };
  }
  return {
    ok: true,
    partner_slug: partnerSlug,
    content,
    target_path: path,
    already_exists: target.hive_mind_present,
  };
}

/**
 * Write the partner-knowledge.md for a slug. Reads the same preview
 * the UI just showed (so what the user saw is what gets written),
 * stops short of git operations.
 */
export async function applyHiveMindEntry(
  partnerSlug: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const preview = await previewHiveMindEntry(partnerSlug);
  if (!preview.ok) return { ok: false, error: preview.error };
  if (preview.already_exists) {
    return {
      ok: false,
      error: `Hive Mind already has an entry for ${partnerSlug}. Edit it directly to update.`,
    };
  }
  try {
    const result = await writeHiveMindPartnerKnowledge(
      partnerSlug,
      preview.content,
    );
    return { ok: true, path: result.path };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// --- internals ---

/**
 * Best-effort partner display-name derivation from a project name.
 *
 * Team51's Linear projects follow "Partner Name | Project Scope" —
 * splitting at the pipe gives a clean partner name. For projects that
 * don't follow that pattern, fall back to the project name as-is, then
 * to the slug as a last resort.
 *
 * The user can edit the preview content before applying anyway, so
 * this just needs to be close enough to be useful.
 */
function derivePartnerDisplayName(
  projectName: string,
  slug: string,
): string {
  const pipeSplit = projectName.split(" | ", 2);
  if (pipeSplit.length === 2) return pipeSplit[0]!.trim();
  const dashSplit = projectName.split(" — ", 2);
  if (dashSplit.length === 2) return dashSplit[0]!.trim();
  if (projectName.trim().length > 0) return projectName.trim();
  return slug;
}

function renderPartnerKnowledge(
  template: string,
  target: VaultPartnerProject,
): string {
  // The template uses literal placeholders ("Partner Name",
  // "YYYY-MM-DD"). Replacement is conservative — only the exact
  // tokens the canonical template ships with — so a team-side
  // template change won't silently corrupt the substitution.
  const today = new Date().toISOString().slice(0, 10);
  const project = target.project;
  const tagsList = project.tags.length
    ? `[${project.tags.map((t) => JSON.stringify(t)).join(", ")}]`
    : "[]";
  const ndaValue = project.nda === true ? "true" : "false";

  return template
    .replace(/^title:\s*"Partner Name"/m, `title: "${target.display_name}"`)
    .replace(/^# Partner Name$/m, `# ${target.display_name}`)
    .replace(/^created:\s*YYYY-MM-DD/m, `created: ${today}`)
    .replace(/^updated:\s*YYYY-MM-DD/m, `updated: ${today}`)
    .replace(/^nda:\s*false$/m, `nda: ${ndaValue}`)
    .replace(/^tags:\s*\[\]$/m, `tags: ${tagsList}`);
}

/**
 * Conservative fallback if the user's Hive Mind clone doesn't have a
 * `templates/partner-knowledge.md`. Mirrors the current canonical
 * template at the time of writing.
 */
const FALLBACK_TEMPLATE = `---
title: "Partner Name"
description: ""
owner: ""
nda: false
tags: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Partner Name

## Overview

Brief description of the partner and the relationship.

## Key Contacts

| Name | Role | Email |
|------|------|-------|

## Links

- Website:
- Slack channel:
- Linear project:

## Notes
`;
