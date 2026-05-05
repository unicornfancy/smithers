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

interface LearnFromArchiveBody {
  draftPath?: string;
}

interface AppliedEntry {
  filename: string;
  heading: string;
}

interface LearnFromArchiveResponse {
  ok: boolean;
  applied?: AppliedEntry[];
  reason?: string;
  error?: string;
}

export async function POST(req: Request) {
  // Validate my-voice is configured.
  const myVoicePath = await getMyVoicePath();
  if (!myVoicePath) {
    return NextResponse.json(
      {
        ok: false,
        reason: "not-configured",
        error:
          "my_voice path is not configured — add paths.my_voice to config.local.yaml",
      } satisfies LearnFromArchiveResponse,
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
      } satisfies LearnFromArchiveResponse,
      { status: 412 },
    );
  }

  // Parse body (optional).
  let _body: LearnFromArchiveBody = {};
  try {
    _body = (await req.json()) as LearnFromArchiveBody;
  } catch {
    // empty body is fine
  }

  const vault = await getVault();

  // Get 5 most recent archived drafts with original_body.
  const samples = await vault.listArchivedDraftsWithDiffs(5).catch(() => []);

  if (samples.length === 0) {
    return NextResponse.json({
      ok: true,
      applied: [],
    } satisfies LearnFromArchiveResponse);
  }

  // Read existing SKILL.md as context.
  const existingStyleGuide = await readMyVoiceFile("SKILL.md");

  const availableFiles = MY_VOICE_FILES.map((f) => f.filename);

  let result;
  try {
    result = await learnStyleFromArchives(agentRuntime, {
      samples: samples.map((s) => ({
        draft_id: s.draft_id,
        title: s.title,
        channel: s.channel,
        source_agent: s.source_agent,
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
      } satisfies LearnFromArchiveResponse,
      { status: 502 },
    );
  }

  const applied: AppliedEntry[] = [];

  for (const addition of result.output.file_additions) {
    // Only write to known files.
    if (!MY_VOICE_FILES.some((f) => f.filename === addition.filename)) continue;

    try {
      const existing = await readMyVoiceFile(addition.filename);
      const newContent = existing
        ? `${existing.trimEnd()}\n\n${addition.content}\n`
        : `${addition.content}\n`;
      await writeMyVoiceFile(addition.filename, newContent);

      // Extract the heading from the content for the response summary.
      const headingMatch = /^##\s+(.+)$/m.exec(addition.content);
      applied.push({
        filename: addition.filename,
        heading: headingMatch ? headingMatch[1]!.trim() : addition.filename,
      });
    } catch {
      // Best-effort; skip this file and continue.
    }
  }

  return NextResponse.json({
    ok: true,
    applied,
  } satisfies LearnFromArchiveResponse);
}
