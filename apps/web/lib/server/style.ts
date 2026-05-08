import "server-only";

import type { StyleReference } from "@smithers/agents";

import { MY_VOICE_FILES, getMyVoicePath, readMyVoiceFile } from "./my-voice";
import { getVault } from "./vault";

/**
 * Single source of truth for the StyleReference passed to draft / chat
 * agents. Prefers the user's `my-voice/` directory when configured —
 * that's where the auto-learn-from-archive route appends learnings, and
 * where the rich, current voice rules live (SKILL, PARTNER_COMMS,
 * INTERNAL_STYLE_GUIDE, EXTERNAL_STYLE_GUIDE, REPORT_STRUCTURE).
 *
 * Falls back to `vault.readStyleGuide()` (a single `*Style Guide.md` at
 * the vault root) for users without `paths.my_voice` configured.
 *
 * Returns null when neither source has content — agents drop the style
 * block gracefully in that case.
 */
export async function loadStyleReference(): Promise<StyleReference | null> {
  const myVoicePath = await getMyVoicePath();
  if (myVoicePath) {
    const sections: string[] = [];
    for (const f of MY_VOICE_FILES) {
      const body = await readMyVoiceFile(f.filename).catch(() => null);
      if (body && body.trim()) {
        sections.push(`## ${f.label} (${f.filename})\n\n${body.trim()}`);
      }
    }
    if (sections.length > 0) {
      return {
        label: "User's voice (my-voice/)",
        body: sections.join("\n\n---\n\n"),
      };
    }
  }

  const vault = await getVault();
  const fallback = await vault.readStyleGuide().catch(() => null);
  if (!fallback?.body) return null;
  return { label: "User's writing style", body: fallback.body };
}
