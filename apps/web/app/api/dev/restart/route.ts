import "server-only";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { NextResponse } from "next/server";

import { findRepoRoot } from "@/lib/server/config-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Restart the dev server. Spawns a fresh `pnpm dev` as a detached
 * child from the repo root, then exits the current process after a
 * short delay (long enough for this response to flush). The browser
 * polls a known endpoint until the new server answers, then reloads.
 *
 * Refuses to run outside development to avoid being a production
 * kill switch. Smithers is a local-dev tool; this endpoint exists
 * for the "I just changed config.local.yaml, please reload it for me"
 * case.
 *
 * Caveats the UI surfaces to the user:
 * - The new child runs with stdio=ignore, so the terminal that
 *   originally hosted `pnpm dev` will go back to a prompt. Logs after
 *   restart are not visible there.
 * - The detached child inherits the same port; there's a ~1-2s
 *   window where requests fail while the new Next process starts up.
 *   The client polls through that gap.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        reason: "production",
        message: "Restart is only available in development.",
      },
      { status: 403 },
    );
  }

  const repoRoot = findRepoRoot();
  if (!existsSync(repoRoot)) {
    return NextResponse.json(
      { ok: false, reason: "no-repo-root", message: `Could not find repo root at ${repoRoot}` },
      { status: 500 },
    );
  }

  try {
    const child = spawn("pnpm", ["dev"], {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    // unref + handle errors so the parent isn't waiting on the child.
    child.unref();
    child.on("error", () => {
      /* swallow — best-effort spawn */
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "spawn-failed",
        message: err instanceof Error ? err.message : "Could not spawn replacement",
      },
      { status: 500 },
    );
  }

  // Schedule the kill after the response has had a chance to flush.
  // 500ms is plenty for a localhost roundtrip; the child has already
  // started its boot.
  setTimeout(() => {
    process.exit(0);
  }, 500);

  return NextResponse.json({
    ok: true,
    message: "Spawning a fresh dev server. Exiting current process in 500ms.",
  });
}
