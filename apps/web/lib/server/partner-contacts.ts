import "server-only";

import type { Project, Vault } from "@smithers/vault";

/**
 * Look up partner contact emails for a list of projects, keyed by
 * project slug. Dedupes HM lookups by partner slug — multiple
 * projects sharing one partner only cost a single HM read.
 *
 * Used by call-matching surfaces (/calls, /today, project workbench)
 * to enrich recordingMatchesProject with email-domain tokens so a
 * Fathom call from a partner contact's email routes to the right
 * project even when the title is generic.
 */
export async function loadPartnerContactsBySlug(
  vault: Vault,
  projects: Pick<Project, "slug" | "partner" | "hive_mind_partner_slug">[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const partnerSlugs = new Set<string>();
  for (const p of projects) {
    const slug = p.hive_mind_partner_slug ?? p.partner;
    if (slug) partnerSlugs.add(slug);
  }
  const cache = new Map<string, string[]>();
  await Promise.all(
    Array.from(partnerSlugs).map(async (ps) => {
      try {
        const partner = await vault.getHiveMindPartner(ps);
        cache.set(
          ps,
          (partner?.contacts ?? []).map((c) => c.email).filter(Boolean),
        );
      } catch {
        cache.set(ps, []);
      }
    }),
  );
  for (const p of projects) {
    const slug = p.hive_mind_partner_slug ?? p.partner;
    if (slug) out.set(p.slug, cache.get(slug) ?? []);
  }
  return out;
}
