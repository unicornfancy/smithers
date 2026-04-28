import { homedir } from "node:os";
import { resolve } from "node:path";

export interface VaultOptions {
  /** Absolute or `~`-prefixed path to the markdown vault. */
  vaultPath: string;
  /**
   * Email domains treated as internal — used by the call-notes attendee classifier.
   * Defaults to ["automattic.com"] when not provided.
   */
  internalEmailDomains?: string[];
}

export interface ResolvedVaultOptions {
  vaultPath: string;
  internalEmailDomains: string[];
}

/** Expand a leading `~` to the user's home directory and resolve to an absolute path. */
export function expandPath(p: string): string {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

export function resolveVaultOptions(opts: VaultOptions): ResolvedVaultOptions {
  return {
    vaultPath: expandPath(opts.vaultPath),
    internalEmailDomains:
      opts.internalEmailDomains?.length
        ? opts.internalEmailDomains
        : ["automattic.com"],
  };
}
