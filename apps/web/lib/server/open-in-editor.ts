import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Hand a file or folder path to the OS so the user's default editor /
 * Finder / Files window opens it. Replaces `<a href="file://...">`
 * which browsers silently block from http:// pages for security
 * reasons — that's why every "Open in editor" / "Open folder" link in
 * Smithers was a no-op in practice.
 *
 * Threat model: this runs in a local single-user dev server, the
 * caller is always the user themself. We still require an absolute
 * path that actually exists on disk — guards against accidentally
 * shelling out to a typo'd / empty / relative string.
 */
export async function openInEditor(
  path: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const trimmed = path.trim();
  if (!trimmed) return { ok: false, reason: "path is required" };
  if (!trimmed.startsWith("/")) {
    return { ok: false, reason: "path must be absolute" };
  }
  if (!existsSync(trimmed)) {
    return { ok: false, reason: `nothing exists at ${trimmed}` };
  }
  try {
    if (platform() === "darwin") {
      // macOS: `open` routes to the default app for the file type
      // (markdown → whatever you set, usually Obsidian for files in
      // a vault) or Finder for directories.
      await execFileAsync("open", [trimmed], { timeout: 5_000 });
    } else if (platform() === "linux") {
      // Linux: xdg-open is the cross-DE equivalent. May not be
      // installed on minimal servers; that throws, we surface the
      // message to the user.
      await execFileAsync("xdg-open", [trimmed], { timeout: 5_000 });
    } else {
      return {
        ok: false,
        reason: `open-in-editor isn't wired for platform "${platform()}" yet`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "open failed",
    };
  }
}
