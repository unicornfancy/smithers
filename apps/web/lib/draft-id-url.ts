/**
 * URL-safe encoding for draft ids.
 *
 * Drafts that haven't been migrated to a real UUID use a `local:<path>`
 * fallback id. The slashes in that path break Next.js single-segment
 * dynamic routes ([id]) — even percent-encoded `%2F` is treated as a
 * separator. base64url avoids the issue entirely by producing an
 * opaque single-segment string.
 *
 * Real UUID ids (8-4-4-4-12 hex) round-trip cleanly because they don't
 * contain reserved chars; we still encode for consistency so callers
 * never have to special-case.
 */
export function encodeDraftIdForUrl(id: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(id, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
  // Browser path: use btoa with utf-8 safety.
  const bytes = new TextEncoder().encode(id);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeDraftIdFromUrl(encoded: string): string {
  const padded =
    encoded.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (encoded.length % 4)) % 4);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf8");
  }
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
