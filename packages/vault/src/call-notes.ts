// Call notes are sourced from the configured transcription provider and dropped
// into `Call Notes/` by the vault watcher's downstream pipeline. Read helpers
// here will return parsed CallNote records once the transcription package lands.
//
// Stubbed for now: the directory listing is implemented so /today can show
// recent call notes, but body/attendee parsing waits on the transcription work.

import { join, relative } from "node:path";

import type { ResolvedVaultOptions } from "./config";
import { fileMtime, listMarkdownFiles } from "./fs";
import { vaultPaths } from "./paths";

export interface CallNoteRef {
  absolute_path: string;
  relative_path: string;
  filename: string;
  modified_at: string;
}

export async function listCallNotes(
  opts: ResolvedVaultOptions,
): Promise<CallNoteRef[]> {
  const paths = vaultPaths(opts);
  const files = await listMarkdownFiles(paths.callNotes);
  const out: CallNoteRef[] = [];
  for (const f of files) {
    const abs = join(paths.callNotes, f);
    out.push({
      absolute_path: abs,
      relative_path: relative(opts.vaultPath, abs),
      filename: f,
      modified_at: (await fileMtime(abs)) ?? new Date(0).toISOString(),
    });
  }
  out.sort((a, b) => b.modified_at.localeCompare(a.modified_at));
  return out;
}
