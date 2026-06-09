import { NextResponse } from "next/server";

import { getTranscriptionAdapter } from "@/lib/server/transcription";

export const dynamic = "force-dynamic";

/**
 * Quick health probe for the currently-configured transcription
 * provider. Used by /settings → Transcription provider card to verify
 * "is this actually reachable" without forcing the user to open /calls
 * and read between the lines.
 */
export async function GET() {
  try {
    const adapter = await getTranscriptionAdapter();
    const health = await adapter.isHealthy();
    return NextResponse.json({ provider: adapter.provider, ...health });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        detail: err instanceof Error ? err.message : "probe failed",
      },
      { status: 500 },
    );
  }
}
