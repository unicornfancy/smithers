// Agenda files live alongside projects (one per project, plus loose ones in
// `Agendas/` for projects without a dedicated folder). Full read helpers — open
// items vs dated archived sections — land with the agenda editor work.

import { join, relative } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import { fileMtime, listMarkdownFiles } from "./fs";
import { vaultPaths } from "./paths";

export interface AgendaRef {
  absolute_path: string;
  relative_path: string;
  filename: string;
  modified_at: string;
}

export async function listAgendas(
  opts: ResolvedVaultOptions,
): Promise<AgendaRef[]> {
  const paths = vaultPaths(opts);
  const files = await listMarkdownFiles(paths.agendas);
  const out: AgendaRef[] = [];
  for (const f of files) {
    const abs = join(paths.agendas, f);
    out.push({
      absolute_path: abs,
      relative_path: relative(opts.vaultPath, abs),
      filename: f,
      modified_at: (await fileMtime(abs)) ?? new Date(0).toISOString(),
    });
  }
  out.sort((a, b) => a.filename.localeCompare(b.filename));
  return out;
}
