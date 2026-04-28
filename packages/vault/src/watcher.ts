import { relative } from "node:path";

import chokidar from "chokidar";

import type { ResolvedVaultOptions } from "./config";
import { vaultPaths } from "./paths";

export type VaultEventKind =
  | "daily-note"
  | "draft"
  | "draft-original"
  | "draft-archived"
  | "call-note"
  | "agenda"
  | "project"
  | "weekly-update"
  | "follow-ups"
  | "style-guide"
  | "working-with"
  | "unknown";

export type VaultChangeType = "add" | "change" | "unlink";

export interface VaultEvent {
  type: VaultChangeType;
  kind: VaultEventKind;
  absolute_path: string;
  relative_path: string;
}

export type VaultEventHandler = (event: VaultEvent) => void | Promise<void>;

export interface VaultWatcher {
  close(): Promise<void>;
}

/**
 * Watch the vault for filesystem changes and dispatch classified events.
 *
 * Implementation notes:
 *
 * - We watch the whole vault root recursively rather than each subfolder,
 *   so files moved between Smithers-managed folders surface as `unlink` +
 *   `add` of the same content. The reconciliation pass higher up in the stack
 *   matches them by stable id (UUID in frontmatter).
 *
 * - Hidden files and `.git`/`.obsidian` metadata are ignored.
 *
 * - `awaitWriteFinish` cushions atomic writes (which look like rapid
 *   write+rename) so the handler isn't fired mid-flight.
 */
export function watchVault(
  opts: ResolvedVaultOptions,
  handler: VaultEventHandler,
): VaultWatcher {
  const paths = vaultPaths(opts);

  const watcher = chokidar.watch(paths.root, {
    ignored: (path: string) =>
      /(^|\/)(\.git|\.obsidian|\.DS_Store|\.smithers-tmp-)/.test(path),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  const dispatch = (type: VaultChangeType) => async (path: string) => {
    if (!path.toLowerCase().endsWith(".md")) return;
    const event: VaultEvent = {
      type,
      kind: classifyPath(opts, path),
      absolute_path: path,
      relative_path: relative(opts.vaultPath, path),
    };
    try {
      await handler(event);
    } catch (err) {
      // We swallow handler errors so a misbehaving listener doesn't take down
      // the watcher; surface them via console for now (will route to the
      // structured logger once it lands).
      // eslint-disable-next-line no-console
      console.error("[smithers/vault] watcher handler threw:", err);
    }
  };

  watcher.on("add", dispatch("add"));
  watcher.on("change", dispatch("change"));
  watcher.on("unlink", dispatch("unlink"));

  return {
    async close() {
      await watcher.close();
    },
  };
}

/**
 * Classify a vault path by its location, so handlers can route without
 * pattern-matching strings.
 */
export function classifyPath(
  opts: ResolvedVaultOptions,
  absolutePath: string,
): VaultEventKind {
  const rel = relative(opts.vaultPath, absolutePath);
  if (rel.startsWith("Daily Notes/")) return "daily-note";
  if (rel.startsWith("Drafts/Originals/")) return "draft-original";
  if (rel.startsWith("Drafts/Archived Drafts/")) return "draft-archived";
  if (rel.startsWith("Drafts/")) return "draft";
  if (rel.startsWith("Call Notes/")) return "call-note";
  if (rel.startsWith("Agendas/")) return "agenda";
  if (rel.startsWith("Projects/")) return "project";
  if (rel.startsWith("Weekly Updates/")) return "weekly-update";
  if (rel === "Follow-ups.md") return "follow-ups";
  if (/^Working With .+\.md$/.test(rel)) return "working-with";
  if (/Style Guide\.md$/.test(rel)) return "style-guide";
  return "unknown";
}
