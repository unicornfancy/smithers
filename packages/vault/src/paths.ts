import { join } from "node:path";

import type { ResolvedVaultOptions } from "./config";

/**
 * Well-known folders and files within a Smithers-compatible vault.
 *
 * The vault structure mirrors the Obsidian-style layout the existing personal-OS
 * uses, so an existing vault works without migration:
 *
 *   <vault>/
 *   ├── Daily Notes/
 *   ├── Drafts/
 *   │   ├── Originals/
 *   │   └── Archived Drafts/
 *   ├── Call Notes/
 *   ├── Agendas/
 *   ├── Projects/
 *   ├── Weekly Updates/
 *   ├── Templates/
 *   ├── Working With <You>.md
 *   ├── <You> Style Guide.md
 *   └── Follow-ups.md
 */
export interface VaultPaths {
  root: string;
  dailyNotes: string;
  drafts: string;
  draftsOriginals: string;
  draftsArchived: string;
  callNotes: string;
  agendas: string;
  projects: string;
  weeklyUpdates: string;
  templates: string;
  followUps: string;
  /**
   * Personal Digest folder — partner-NDA-safe personal reflection
   * surface. Holds weekly highlight files (YYYY-WNN.md) and a single
   * Development.md tracker for goals / skills / things to revisit.
   */
  personalDigest: string;
  personalDevelopment: string;
}

export function vaultPaths(opts: ResolvedVaultOptions): VaultPaths {
  const root = opts.vaultPath;
  return {
    root,
    dailyNotes: join(root, "Daily Notes"),
    drafts: join(root, "Drafts"),
    draftsOriginals: join(root, "Drafts", "Originals"),
    draftsArchived: join(root, "Drafts", "Archived Drafts"),
    callNotes: join(root, "Call Notes"),
    agendas: join(root, "Agendas"),
    projects: join(root, "Projects"),
    weeklyUpdates: join(root, "Weekly Updates"),
    templates: join(root, "Templates"),
    followUps: join(root, "Follow-ups.md"),
    personalDigest: join(root, "Personal Digest"),
    personalDevelopment: join(root, "Personal Digest", "Development.md"),
  };
}
