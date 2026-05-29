import "server-only";

import { NextResponse } from "next/server";

import { learnStyleFromArchives } from "@smithers/agents";

import { getAgentRuntime } from "@/lib/server/agents";
import { MY_VOICE_FILES } from "@/lib/my-voice-files";
import {
  getMyVoicePath,
  readMyVoiceFile,
  writeMyVoiceFile,
} from "@/lib/server/my-voice";
import { getVault } from "@/lib/server/vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AppliedEntry {
  filename: string;
  heading: string;
}

interface LearnFromWeeklyArchivesResponse {
  ok: boolean;
  applied?: AppliedEntry[];
  reason?: string;
  error?: string;
}

/**
 * Mirror of /api/learn-from-archive but scoped to weekly updates.
 * Pulls samples via vault.listWeeklyUpdatesWithDiffs (only files where
 * the user actually edited the AI's first pass), feeds them to the
 * shared learnStyleFromArchives agent with channel="weekly-update", and
 * routes the agent's `file_additions` into my-voice/ (typically
 * WEEKLY_UPDATE_STYLE.md per the routing rule in the system prompt).
 *
 * Fired from the weekly-update editor on save. No body — server-side
 * scoping is enough. Returns the list of files that received new
 * sections so the client can toast.
 */
export async function POST(_req: Request) {
  const myVoicePath = await getMyVoicePath();
  if (!myVoicePath) {
    return NextResponse.json(
      {
        ok: false,
        reason: "not-configured",
        error:
          "my_voice path is not configured — add paths.my_voice to config.local.yaml",
      } satisfies LearnFromWeeklyArchivesResponse,
      { status: 412 },
    );
  }

  const agentRuntime = await getAgentRuntime();
  if (!agentRuntime) {
    return NextResponse.json(
      {
        ok: false,
        reason: "not-configured",
        error: "ANTHROPIC_API_KEY not set",
      } satisfies LearnFromWeeklyArchivesResponse,
      { status: 412 },
    );
  }

  const vault = await getVault();
  const samples = await vault
    .listWeeklyUpdatesWithDiffs(5)
    .catch(() => []);

  if (samples.length === 0) {
    return NextResponse.json({
      ok: true,
      applied: [],
    } satisfies LearnFromWeeklyArchivesResponse);
  }

  const existingStyleGuide = await readMyVoiceFile("WEEKLY_UPDATE_STYLE.md");
  const availableFiles = MY_VOICE_FILES.map((f) => f.filename);

  let result;
  try {
    result = await learnStyleFromArchives(agentRuntime, {
      samples: samples.map((s) => ({
        draft_id: s.iso_week,
        title: `Weekly Update — ${s.iso_week}`,
        channel: "weekly-update",
        source_agent: "compose-weekly-update",
        original: s.original_body,
        final: s.final_body,
      })),
      existing_style_guide: existingStyleGuide ?? undefined,
      available_files: availableFiles,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "error",
        error: err instanceof Error ? err.message : "Agent call failed",
      } satisfies LearnFromWeeklyArchivesResponse,
      { status: 502 },
    );
  }

  const applied: AppliedEntry[] = [];
  for (const addition of result.output.file_additions) {
    if (!MY_VOICE_FILES.some((f) => f.filename === addition.filename)) continue;
    try {
      const existing = await readMyVoiceFile(addition.filename);
      const newContent = existing
        ? `${existing.trimEnd()}\n\n${addition.content}\n`
        : `${addition.content}\n`;
      await writeMyVoiceFile(addition.filename, newContent);
      const headingMatch = /^##\s+(.+)$/m.exec(addition.content);
      applied.push({
        filename: addition.filename,
        heading: headingMatch ? headingMatch[1]!.trim() : addition.filename,
      });
    } catch {
      // Best-effort; skip this file.
    }
  }

  return NextResponse.json({
    ok: true,
    applied,
  } satisfies LearnFromWeeklyArchivesResponse);
}
