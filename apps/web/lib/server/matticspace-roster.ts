import "server-only";

import { loadConfig } from "@/lib/server/config";
import { getMcpClient } from "@/lib/server/mcp";

/**
 * Server-side helper for the @-handle verification flow. Loads the
 * configured Matticspace groups (same slugs the team-roster sync uses)
 * and returns a serializable map the client can use to check draft
 * mentions against.
 *
 * The MCP client's matticspace tool already has a 1h SWR cache, so
 * subsequent calls within an hour are free.
 */

export interface HandleMapPerson {
  /** Display name from matticspace ("Christy Nyiri"). */
  name: string;
  /** Canonical P2 mention handle. The thing `@-mentions should use. */
  wp_username: string;
  /** Source group slug — surfaced in the UI when a name is ambiguous. */
  group_slug: string;
}

export interface MatticspaceHandleMap {
  /** Every known wp_username, lowercased — for "already correct" detection. */
  known_wp_usernames: string[];
  /**
   * Lookup map keyed by lowercased candidate. Values are the people
   * who match — usually one, but the client should handle multiple
   * (ambiguous first-name) gracefully.
   *
   * Candidate keys included per person:
   *   - first name slugified ("christy")
   *   - last name slugified ("nyiri")
   *   - full name slug-kebab ("christy-nyiri")
   *   - full name slug-concat ("christynyiri")
   *
   * The wp_username itself is NOT in this map — clients should check
   * known_wp_usernames first to short-circuit on already-correct
   * mentions.
   */
  by_candidate: Record<string, HandleMapPerson[]>;
}

export async function getMatticspaceHandleMap(): Promise<MatticspaceHandleMap> {
  const cfg = await loadConfig();
  const slugs =
    cfg.schedule?.team_roster_sync?.group_slugs ??
    (cfg.schedule?.team_roster_sync?.group_slug
      ? [cfg.schedule.team_roster_sync.group_slug]
      : ["team-51", "team-51-contractors"]);
  const mcp = await getMcpClient();
  const people: HandleMapPerson[] = [];
  for (const slug of slugs) {
    const result = await mcp.contextA8C
      .listMatticspaceGroupMembers(slug, { includeSubteams: true })
      .catch(() => null);
    if (!result?.ok) continue;
    for (const m of result.data.members) {
      if (!m.wp_username) continue;
      people.push({
        name: m.name,
        wp_username: m.wp_username,
        group_slug: slug,
      });
    }
  }

  // Dedupe by wp_username — a person can appear in multiple groups
  // (e.g. someone moves from contractor to FT and remains in both
  // groups during the transition).
  const seen = new Set<string>();
  const unique: HandleMapPerson[] = [];
  for (const p of people) {
    if (seen.has(p.wp_username)) continue;
    seen.add(p.wp_username);
    unique.push(p);
  }

  const known_wp_usernames = unique.map((p) => p.wp_username.toLowerCase());

  const by_candidate: Record<string, HandleMapPerson[]> = {};
  function push(key: string, person: HandleMapPerson) {
    const k = key.toLowerCase().trim();
    if (!k) return;
    if (!by_candidate[k]) by_candidate[k] = [];
    by_candidate[k]!.push(person);
  }

  for (const p of unique) {
    const parts = p.name
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) continue;
    const first = slugify(parts[0]!);
    const last = parts.length > 1 ? slugify(parts[parts.length - 1]!) : "";
    const fullKebab = parts.map(slugify).filter(Boolean).join("-");
    const fullConcat = parts.map(slugify).filter(Boolean).join("");
    if (first) push(first, p);
    if (last && last !== first) push(last, p);
    if (fullKebab && fullKebab !== first) push(fullKebab, p);
    if (fullConcat && fullConcat !== fullKebab) push(fullConcat, p);
  }

  return { known_wp_usernames, by_candidate };
}

/**
 * Light slugify — drops accents, lowercases, strips non-alphanumeric.
 * Note: leaves no dashes — used for component-level keys, not full slugs.
 */
function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacriticals
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
