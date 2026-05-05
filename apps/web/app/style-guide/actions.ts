"use server";

import { MY_VOICE_FILES } from "@/lib/my-voice-files";
import {
  getMyVoicePath,
  readMyVoiceFile,
  writeMyVoiceFile,
} from "@/lib/server/my-voice";

/** Read a my-voice file by filename. Returns null if unconfigured or missing. */
export async function readStyleFileAction(
  filename: string,
): Promise<string | null> {
  if (!MY_VOICE_FILES.some((f) => f.filename === filename)) return null;
  return readMyVoiceFile(filename);
}

/** Write a my-voice file. Returns ok/error. */
export async function saveStyleFileAction(
  filename: string,
  content: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!MY_VOICE_FILES.some((f) => f.filename === filename)) {
    return { ok: false, message: `Unknown file: ${filename}` };
  }
  try {
    await writeMyVoiceFile(filename, content);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Write failed",
    };
  }
}

/** Return whether the my_voice path is configured. */
export async function getMyVoiceStatusAction(): Promise<{
  configured: boolean;
  path: string | null;
}> {
  const path = await getMyVoicePath();
  return { configured: path !== null, path };
}
