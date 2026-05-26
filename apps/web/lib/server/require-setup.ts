import "server-only";

import { existsSync, statSync } from "node:fs";
import { redirect } from "next/navigation";

import { getVault } from "@/lib/server/vault";

/**
 * Bounce visitors to `/setup` when the vault path isn't configured or
 * points at something that isn't a directory. Anything past this guard
 * can safely call vault helpers without checking `vault.status().exists`.
 *
 * Call from page-level RSCs that are entry points for fresh-clone users
 * (root `/`, `/today`). Other pages keep their inline empty-state notices
 * so a user who deliberately navigates somewhere mid-config still sees
 * the helpful message instead of getting bounced.
 */
export async function requireConfiguredVault(): Promise<void> {
  const vault = await getVault();
  const status = vault.status();
  if (!status.vault_path) {
    redirect("/setup");
  }
  if (!existsSync(status.vault_path)) {
    redirect("/setup");
  }
  try {
    if (!statSync(status.vault_path).isDirectory()) {
      redirect("/setup");
    }
  } catch {
    // stat failure (permissions, transient) — treat as missing.
    redirect("/setup");
  }
}
