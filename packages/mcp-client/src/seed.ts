// Deterministic seeded RNG used by mock transports.
//
// Same project + day → same generated activity. This keeps the demo data
// stable across page reloads while still varying day-to-day so the UI looks
// alive when the user comes back tomorrow.

/** Mulberry32 — small, fast, good-enough for mock data. */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** djb2 string hash for stable seed derivation. */
export function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/** A seed that varies per UTC day so demo data refreshes daily. */
export function dailySeed(key: string, now: Date = new Date()): number {
  const day = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
  return hashString(`${key}::${day}`);
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("pick: empty items");
  }
  return items[Math.floor(rng() * items.length)] as T;
}

/** Choose `count` items without replacement (or fewer if items is small). */
export function pickN<T>(
  rng: () => number,
  items: readonly T[],
  count: number,
): T[] {
  const pool = items.slice();
  const out: T[] = [];
  const target = Math.min(count, pool.length);
  for (let i = 0; i < target; i += 1) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0] as T);
  }
  return out;
}
