import "server-only";

import type { Agenda } from "@smithers/vault";

import { getVault } from "./vault";

/**
 * Find the agenda file whose frontmatter `partner:` matches the given
 * partner slug. Returns the parsed Agenda or null when nothing matches
 * — the workbench surface treats that as "no agenda linked yet" and
 * shows a CTA explaining how to add the frontmatter.
 *
 * Linear scan over the agendas directory (small N — Katie has 4 files
 * in practice). Each match candidate is parsed via readAgenda so we
 * pull the frontmatter; full body parse is cheap enough at this size.
 */
export async function findAgendaForPartner(
  partnerSlug: string | undefined,
): Promise<Agenda | null> {
  if (!partnerSlug) return null;
  const vault = await getVault();
  const refs = await vault.listAgendas().catch(() => []);
  for (const ref of refs) {
    const agenda = await vault.readAgenda(ref.filename).catch(() => null);
    if (!agenda) continue;
    if (agenda.partner === partnerSlug) {
      return agenda;
    }
  }
  return null;
}
