import { existsSync, statSync } from "node:fs";

import type { ResolvedVaultOptions } from "./config";
import { vaultPaths } from "./paths";
import type { VaultStatus } from "./types";

/**
 * Quick-and-cheap check of the vault layout. Used by /today and /setup to tell
 * the user whether things look right before we start reading content.
 */
export function readVaultStatus(opts: ResolvedVaultOptions): VaultStatus {
  const paths = vaultPaths(opts);
  const exists = checkExists(paths.root, "dir");

  const expected: VaultStatus["expected_paths"] = [
    { path: paths.dailyNotes, kind: "dir", present: checkExists(paths.dailyNotes, "dir") },
    { path: paths.drafts, kind: "dir", present: checkExists(paths.drafts, "dir") },
    { path: paths.callNotes, kind: "dir", present: checkExists(paths.callNotes, "dir") },
    { path: paths.agendas, kind: "dir", present: checkExists(paths.agendas, "dir") },
    { path: paths.projects, kind: "dir", present: checkExists(paths.projects, "dir") },
    { path: paths.weeklyUpdates, kind: "dir", present: checkExists(paths.weeklyUpdates, "dir") },
    { path: paths.followUps, kind: "file", present: checkExists(paths.followUps, "file") },
  ];

  return {
    exists,
    vault_path: paths.root,
    has_expected_layout: exists && expected.every((e) => e.present),
    expected_paths: expected,
  };
}

function checkExists(path: string, kind: "dir" | "file"): boolean {
  if (!existsSync(path)) return false;
  try {
    const s = statSync(path);
    return kind === "dir" ? s.isDirectory() : s.isFile();
  } catch {
    return false;
  }
}
