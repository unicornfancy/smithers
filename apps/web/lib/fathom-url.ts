/**
 * Derive a Fathom call URL from a numeric recording id.
 *
 * Fathom's internal call pages live at fathom.video/calls/<id> — the
 * exact shape list_meetings returns as each meeting's url. Older calls
 * fall out of the live list window and external imports have
 * non-numeric ids, so this reconstructs the link whenever the id is
 * all digits and returns undefined otherwise. /calls/ links are
 * viewable by the user's Fathom teammates (not partner-public).
 *
 * Client-safe: no transport deps.
 */
export function fathomCallUrl(recordingId: string | undefined): string | undefined {
  if (!recordingId || !/^\d+$/.test(recordingId)) return undefined;
  return `https://fathom.video/calls/${recordingId}`;
}
