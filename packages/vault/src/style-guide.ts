// Read/write helpers for the user's `<You> Style Guide.md` and
// `Working With <You>.md`. We auto-detect the filename rather than requiring
// configuration, since both are conventionally named after the user.

import { join, relative } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import { fileMtime, listDir, tryReadFile } from "./fs";

export interface FoundFile {
  absolute_path: string;
  relative_path: string;
  filename: string;
  body: string;
  modified_at: string;
}

/** Locate `*Style Guide.md` at the vault root. Returns the first match. */
export async function readStyleGuide(
  opts: ResolvedVaultOptions,
): Promise<FoundFile | null> {
  return findRootMarkdown(opts, /Style Guide\.md$/);
}

/** Locate `Working With *.md` at the vault root. Returns the first match. */
export async function readWorkingWith(
  opts: ResolvedVaultOptions,
): Promise<FoundFile | null> {
  return findRootMarkdown(opts, /^Working With .+\.md$/);
}

async function findRootMarkdown(
  opts: ResolvedVaultOptions,
  pattern: RegExp,
): Promise<FoundFile | null> {
  const entries = await listDir(opts.vaultPath);
  const match = entries.find((e) => e.isFile && pattern.test(e.name));
  if (!match) return null;
  const abs = join(opts.vaultPath, match.name);
  const body = (await tryReadFile(abs)) ?? "";
  return {
    absolute_path: abs,
    relative_path: relative(opts.vaultPath, abs),
    filename: match.name,
    body,
    modified_at: (await fileMtime(abs)) ?? new Date(0).toISOString(),
  };
}
