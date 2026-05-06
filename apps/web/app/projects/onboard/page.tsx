import type {
  HiveMindPartnerSummary,
  HiveMindProjectSummary,
  LinearProjectSummary,
} from "@smithers/mcp-client";
import type { Project } from "@smithers/vault";

import { AppHeader } from "@/components/app-header";
import { OnboardTable } from "@/components/onboard-table";
import { PageShell } from "@/components/page-shell";
import { getMcpClient } from "@/lib/server/mcp";
import { getVault } from "@/lib/server/vault";

export const metadata = {
  title: "Onboarding · Smithers",
};

export const dynamic = "force-dynamic";

export interface OnboardRow {
  /** Stable id for React keys + multi-select. */
  rowKey: string;
  /** Display name — picks the most informative source available. */
  displayName: string;
  /** Vault project slug, when a vault file exists for this row. */
  vaultSlug?: string;
  /** Vault project's `partner` field — used to auto-suggest HM partner on Connect. */
  vaultPartner?: string;
  /** Hive-Mind reference, when an HM project exists for this row. */
  hm?: { partnerSlug: string; projectSlug: string; title: string };
  /** Linear reference, when a Linear project lines up with this row. */
  linear?: { id: string; slugId: string; name: string; state: string };
  /** Derived: which action button to show. */
  action: "open" | "import" | "connect" | "setup" | "linkLinear" | "none";
}

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const showAll = all === "1";

  const vault = await getVault();
  const mcp = await getMcpClient();

  const [vaultProjects, linearProjects, hmProjects, hmPartners] = await Promise.all([
    vault.listProjects().catch(() => []),
    mcp.linear
      .listMyProjects(showAll ? { states: [] } : undefined)
      .catch(() => []),
    mcp.hiveMind.listProjects().catch(() => []),
    mcp.hiveMind.listPartners().catch(() => []),
  ]);

  const rows = buildRows({ vaultProjects, linearProjects, hmProjects });

  const linkable = rows.filter(
    (r) => r.action === "import" || r.action === "connect" || r.action === "setup",
  );

  return (
    <>
      <AppHeader
        title="Onboarding"
        subtitle={`${rows.length} projects across Linear, Hive-Mind, and your vault — ${linkable.length} unlinked`}
      />
      <PageShell>
        <OnboardTable rows={rows} showAll={showAll} hmPartners={hmPartners} />
      </PageShell>
    </>
  );
}

function buildRows({
  vaultProjects,
  linearProjects,
  hmProjects,
}: {
  vaultProjects: Project[];
  linearProjects: LinearProjectSummary[];
  hmProjects: HiveMindProjectSummary[];
}): OnboardRow[] {
  const rowsByKey = new Map<string, OnboardRow>();

  // Pass 1: every vault project becomes a row.
  for (const v of vaultProjects) {
    if (v.kind !== "partner" && v.kind !== "team") continue;
    const key = `vault:${v.slug}`;
    rowsByKey.set(key, {
      rowKey: key,
      displayName: v.name,
      vaultSlug: v.slug,
      vaultPartner: v.partner,
      hm: v.hive_mind_partner_slug && v.hive_mind_project_slug
        ? {
            partnerSlug: v.hive_mind_partner_slug,
            projectSlug: v.hive_mind_project_slug,
            title: v.name,
          }
        : undefined,
      linear: v.linear_project_id
        ? { id: v.linear_project_id, slugId: v.linear_project_slug ?? "", name: v.name, state: "" }
        : undefined,
      action: "none",
    });
  }

  // Pass 2: HM projects without a vault row become new rows.
  for (const p of hmProjects) {
    const key = `hm:${p.partnerSlug}/${p.projectSlug}`;
    const existing = Array.from(rowsByKey.values()).find(
      (r) =>
        r.hm?.partnerSlug === p.partnerSlug &&
        r.hm?.projectSlug === p.projectSlug,
    );
    if (existing) continue;
    rowsByKey.set(key, {
      rowKey: key,
      displayName: p.title,
      hm: { partnerSlug: p.partnerSlug, projectSlug: p.projectSlug, title: p.title },
      action: "none",
    });
  }

  // Pass 3: join Linear projects to existing rows. Match strategy:
  //   1. id or slugId match against any pre-stored Linear ref (vault frontmatter
  //      may use either — Smithers stores `linear_project_id` as the slugId
  //      since that's what users paste from URLs, while Linear's GraphQL `id`
  //      is the full UUID).
  //   2. Fall back to a normalized name match against HM-only rows so that an
  //      imported HM project surfaces as already-linked to its Linear twin.
  for (const lp of linearProjects) {
    const existing = Array.from(rowsByKey.values()).find((r) => {
      if (r.linear?.id === lp.id) return true;
      if (r.linear?.id === lp.slugId) return true;
      if (r.linear?.slugId && r.linear.slugId === lp.slugId) return true;
      // Name fallback for HM-only rows that haven't been Linear-linked yet.
      if (!r.linear && r.hm) {
        return normalizeName(r.displayName) === normalizeName(lp.name);
      }
      return false;
    });
    if (existing) {
      // Backfill from Linear; it's the authoritative source for name/state.
      existing.linear = {
        id: lp.id,
        slugId: lp.slugId,
        name: lp.name,
        state: lp.state,
      };
      continue;
    }
    const key = `linear:${lp.id}`;
    rowsByKey.set(key, {
      rowKey: key,
      displayName: lp.name,
      linear: { id: lp.id, slugId: lp.slugId, name: lp.name, state: lp.state },
      action: "none",
    });
  }

  // Compute action per row from the gap pattern.
  for (const row of rowsByKey.values()) {
    const hasVault = Boolean(row.vaultSlug);
    const hasHm = Boolean(row.hm);
    const hasLinear = Boolean(row.linear);
    if (hasVault && hasHm) row.action = "open";
    else if (!hasVault && hasHm) row.action = "import";
    else if (hasVault && !hasHm) row.action = "connect";
    else if (hasLinear && !hasHm && !hasVault) row.action = "setup";
    else row.action = "none";
  }

  return Array.from(rowsByKey.values()).sort((a, b) => {
    // Unlinked rows first (most actionable), then linked.
    const aLinked = a.action === "open" || a.action === "none";
    const bLinked = b.action === "open" || b.action === "none";
    if (aLinked !== bLinked) return aLinked ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
