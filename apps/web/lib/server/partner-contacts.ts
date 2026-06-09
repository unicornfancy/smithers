import "server-only";

import type { Project, Vault } from "@smithers/vault";

export interface PartnerContactSignals {
  emails: string[];
  names: string[];
}

/**
 * Look up partner contact signals (emails + names) for a list of
 * projects, keyed by project slug. Dedupes HM lookups by partner slug
 * — multiple projects sharing one partner only cost a single HM read.
 *
 * Used by call-matching surfaces (/calls, /today, project workbench)
 * to enrich recordingMatchesProject. Emails feed the domain-mid-segment
 * tokenizer; names feed the multi-word phrase matcher, which catches
 * the calendar-link case where the meeting title is just the partner
 * contact's name.
 */
export async function loadPartnerContactsBySlug(
  vault: Vault,
  projects: Pick<Project, "slug" | "partner" | "hive_mind_partner_slug">[],
): Promise<Map<string, PartnerContactSignals>> {
  const out = new Map<string, PartnerContactSignals>();
  const partnerSlugs = new Set<string>();
  for (const p of projects) {
    const slug = p.hive_mind_partner_slug ?? p.partner;
    if (slug) partnerSlugs.add(slug);
  }
  const cache = new Map<string, PartnerContactSignals>();
  await Promise.all(
    Array.from(partnerSlugs).map(async (ps) => {
      try {
        const partner = await vault.getHiveMindPartner(ps);
        const contacts = partner?.contacts ?? [];
        cache.set(ps, {
          emails: contacts.map((c) => c.email).filter(Boolean),
          names: contacts
            .map((c) => c.name?.trim())
            .filter((n): n is string => Boolean(n)),
        });
      } catch {
        cache.set(ps, { emails: [], names: [] });
      }
    }),
  );
  for (const p of projects) {
    const slug = p.hive_mind_partner_slug ?? p.partner;
    if (slug) out.set(p.slug, cache.get(slug) ?? { emails: [], names: [] });
  }
  return out;
}
