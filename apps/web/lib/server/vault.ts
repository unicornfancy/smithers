import "server-only";

import { createVault, type Vault } from "@smithers/vault";

import { loadConfig } from "./config";

let cached: Vault | null = null;

/**
 * Get a configured Vault instance, lazily built from the loaded config.
 *
 * This is server-only — never imported into a Client Component. RSC pages
 * call this directly; Server Actions call this when they need to write.
 */
export async function getVault(): Promise<Vault> {
  if (cached) return cached;
  const config = await loadConfig();
  cached = createVault({
    vaultPath: config.paths.vault,
    hiveMindPath: config.paths.hive_mind,
    internalEmailDomains: config.identity.internal_email_domains,
  });
  return cached;
}
