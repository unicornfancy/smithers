import "server-only";

import { existsSync } from "node:fs";

import { NextResponse } from "next/server";

import { loadConfig } from "@/lib/server/config";
import {
  detectKosh,
  getKoshCloneStatus,
  syncKoshClone,
} from "@/lib/server/kosh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Move the local Kosh clone onto whatever the config'd channel
 * resolves to (latest tag on `stable`, trunk on `trunk`, a specific
 * tag on `pinned`). Fast-forward-only for branches; detached checkout
 * for tags. Refuses on a dirty tracked-file working tree.
 *
 * The existing `maybeUpdateKosh` in kosh.ts auto-runs before every QA
 * run using the same helper. This route is the manual button — use it
 * when you know a release just landed and don't want to wait for the
 * next audit, or after switching channels in the UI.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        reason: "production",
        message: "Kosh update is only available in development.",
      },
      { status: 403 },
    );
  }

  const detect = await detectKosh();
  if (!detect.kosh_path || !existsSync(detect.kosh_path)) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no-kosh-path",
        message:
          detect.reason ??
          "Kosh path not configured — set paths.kosh in config.local.yaml.",
      },
      { status: 404 },
    );
  }

  const cfg = await loadConfig();
  const result = await syncKoshClone(detect.kosh_path, cfg.kosh);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: "sync-failed", message: result.summary },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    changed: result.changed,
    channel: cfg.kosh.channel,
    target_kind: result.target?.kind ?? null,
    target_name: result.target?.name ?? null,
    head_sha: result.head?.slice(0, 7) ?? null,
    summary: result.summary,
  });
}

/**
 * Read-only clone status. Card renders channel + resolved version +
 * (for the pinned dropdown) the list of available tags.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, reason: "production" },
      { status: 403 },
    );
  }
  const detect = await detectKosh();
  if (!detect.kosh_path || !existsSync(detect.kosh_path)) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no-kosh-path",
        message: detect.reason ?? "Kosh path not configured.",
      },
      { status: 404 },
    );
  }
  try {
    const [cfg, status] = await Promise.all([
      loadConfig(),
      getKoshCloneStatus(detect.kosh_path),
    ]);
    return NextResponse.json({
      ok: true,
      branch: status.branch,
      head: status.head_oneline,
      head_sha: status.head_sha.slice(0, 7),
      current_tag: status.current_tag,
      latest_tag: status.latest_tag,
      available_tags: status.available_tags,
      channel: cfg.kosh.channel,
      pinned_tag: cfg.kosh.pinned_tag ?? "",
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "git-failed",
        message: err instanceof Error ? err.message : "git command failed",
      },
      { status: 500 },
    );
  }
}
