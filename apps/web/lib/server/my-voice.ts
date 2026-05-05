import "server-only";
// Read/write helpers for the my-voice skill directory (application config,
// not vault content). All functions return null/[] gracefully when
// my_voice_path is unconfigured or the file is missing.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { MY_VOICE_FILES } from "@/lib/my-voice-files";
import { loadConfig } from "./config";

export { MY_VOICE_FILES };

/** Resolved absolute path to the my-voice directory, or null if unconfigured. */
export async function getMyVoicePath(): Promise<string | null> {
  const cfg = await loadConfig();
  const p = cfg.paths.my_voice;
  if (!p || p.trim() === "") return null;
  return p;
}

/** Read a my-voice file by filename. Returns null if unconfigured or file missing. */
export async function readMyVoiceFile(filename: string): Promise<string | null> {
  const dir = await getMyVoicePath();
  if (!dir) return null;
  try {
    return await readFile(join(dir, filename), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Write a my-voice file with an atomic temp-then-rename so a crash mid-write
 * never corrupts the skill file.
 *
 * Throws if the my_voice path is not configured.
 */
export async function writeMyVoiceFile(
  filename: string,
  content: string,
): Promise<void> {
  const dir = await getMyVoicePath();
  if (!dir) {
    throw new Error(
      "my_voice path is not configured — add paths.my_voice to config.local.yaml",
    );
  }
  await mkdir(dir, { recursive: true });
  const target = join(dir, filename);
  const tmp = `${target}.smithers-tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, target);
}

