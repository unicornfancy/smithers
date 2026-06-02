import { getMcpClient } from "./mcp";
import { getVault } from "./vault";

/**
 * A single entry in the Ask Smithers palette index. Each entry is a
 * thing the user can search for + take an action on (navigate to,
 * add a task to, attach a Zendesk ticket to, etc.).
 *
 * Kind drives both the icon shown in the palette and which actions
 * are offered as second-step choices. Keep this list short and
 * additive — new kinds should map cleanly onto the action catalog.
 */
export type PaletteEntryKind =
  | "project-vault"
  | "partner-hm"
  | "project-hm"
  | "page"
  | "follow-up";

export interface PaletteEntry {
  /** Stable id within a kind. `<kind>:<slug>` works fine. */
  id: string;
  kind: PaletteEntryKind;
  /** Primary label (project name, partner title, page label, follow-up task). */
  label: string;
  /** Optional secondary line (partner slug, page subtitle, follow-up "to: <project>"). */
  description?: string;
  /** Where Navigation should send the user when picking this entry. */
  href?: string;
  /**
   * ISO date used for the recency boost in scoring. We use a coarse
   * signal here — vault projects: file mtime if available; follow-ups:
   * `sent` date; HM rows: undefined (the index already caps these).
   */
  last_touched_at?: string;
  /**
   * For project-vault entries: the canonical project slug used by
   * server actions. Lets the Add task / Set status / Attach Zendesk
   * flows route to `/projects/<slug>/actions.ts` without re-deriving.
   */
  project_slug?: string;
  /**
   * For partner-hm + project-hm entries: HM partner slug. Used to
   * route to /partner-knowledge/<slug> on navigate.
   */
  partner_slug?: string;
}

export interface PaletteIndex {
  generated_at: string;
  entries: PaletteEntry[];
}

/**
 * Static pages catalog — the routes a user might want to jump to
 * via Ask Smithers. Sidebar order, minus the now-removed /search.
 * Add new top-level pages here when they ship.
 */
const STATIC_PAGES: Array<{ href: string; label: string; description: string }> = [
  { href: "/today", label: "Today", description: "Daily focus + signals" },
  { href: "/projects", label: "Projects", description: "All vault + HM projects" },
  { href: "/calls", label: "Calls", description: "Fathom recordings + analysis" },
  { href: "/drafts", label: "Drafts", description: "P2 + reply drafts" },
  { href: "/agendas", label: "Agendas", description: "Per-project agendas" },
  { href: "/follow-ups", label: "Follow-ups", description: "Open + resolved follow-ups" },
  { href: "/weekly-updates", label: "Weekly Updates", description: "Team P2 weekly updates" },
  { href: "/style-guide", label: "Style Guide", description: "Voice & format references" },
  { href: "/partner-knowledge", label: "Partner Knowledge", description: "HM partner pages" },
  { href: "/settings", label: "Settings", description: "App configuration" },
  { href: "/setup", label: "Setup", description: "First-run wizard" },
];

/**
 * In-process cache so /api/palette-index can serve hot reads cheaply.
 * 5-minute TTL matches the design doc — fresh enough for vault edits
 * to show up within one palette open, cheap enough that mashing Cmd-K
 * doesn't re-hit MCP every time.
 */
let cached: { generated_at: number; index: PaletteIndex } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidatePaletteIndex(): void {
  cached = null;
}

export async function getPaletteIndex(opts?: { force?: boolean }): Promise<PaletteIndex> {
  const now = Date.now();
  if (!opts?.force && cached && now - cached.generated_at < CACHE_TTL_MS) {
    return cached.index;
  }

  const entries: PaletteEntry[] = [];

  // 1) Vault projects
  const vault = await getVault();
  const vaultProjects = await vault.listProjects();
  const vaultPartnerSlugs = new Set<string>();
  for (const p of vaultProjects) {
    entries.push({
      id: `project-vault:${p.slug}`,
      kind: "project-vault",
      label: p.name,
      description: descForVaultProject(p),
      href: `/projects/${p.slug}`,
      project_slug: p.slug,
      last_touched_at: p.modified_at ?? undefined,
    });
    if (p.partner) vaultPartnerSlugs.add(p.partner);
  }

  // 2) HM partners + 3) HM projects not already in vault. Both are
  // best-effort — if the HM MCP is unreachable, we degrade to vault +
  // pages and let the palette still work.
  try {
    const mcp = await getMcpClient();
    const partners = await mcp.hiveMind.listPartners();
    for (const partner of partners) {
      entries.push({
        id: `partner-hm:${partner.slug}`,
        kind: "partner-hm",
        label: partner.title,
        description: partner.owner ? `Owner: ${partner.owner}` : undefined,
        href: `/partner-knowledge/${partner.slug}`,
        partner_slug: partner.slug,
      });
    }

    const hmProjects = await mcp.hiveMind.listProjects();
    for (const proj of hmProjects) {
      const compositeSlug = `${proj.partnerSlug}-${proj.projectSlug}`;
      if (vaultPartnerSlugs.has(proj.partnerSlug)) continue;
      entries.push({
        id: `project-hm:${compositeSlug}`,
        kind: "project-hm",
        label: proj.title,
        description: `HM · ${proj.partnerSlug} · ${proj.status || "no-status"}`,
        href: `/partner-knowledge/${proj.partnerSlug}`,
        partner_slug: proj.partnerSlug,
      });
    }
  } catch {
    // Swallow — palette still useful with vault + pages alone.
  }

  // 4) Open follow-ups (active list only)
  try {
    const followUps = await vault.listFollowUps();
    for (const fu of followUps.active) {
      entries.push({
        id: `follow-up:${fu.follow_up_id}`,
        kind: "follow-up",
        label: fu.task,
        description: `Follow-up · ${fu.project}${fu.sent ? ` · sent ${fu.sent}` : ""}`,
        href: "/follow-ups",
        last_touched_at: fu.sent,
      });
    }
  } catch {
    // Vault may not have a Follow-ups.md file yet — skip.
  }

  // 5) Static pages
  for (const page of STATIC_PAGES) {
    entries.push({
      id: `page:${page.href}`,
      kind: "page",
      label: page.label,
      description: page.description,
      href: page.href,
    });
  }

  const index: PaletteIndex = {
    generated_at: new Date().toISOString(),
    entries,
  };
  cached = { generated_at: now, index };
  return index;
}

function descForVaultProject(p: {
  partner?: string;
  kind: string;
  status?: string;
}): string {
  const parts: string[] = [];
  if (p.partner) parts.push(p.partner);
  parts.push(p.kind);
  if (p.status) parts.push(p.status);
  return parts.join(" · ");
}
