import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

import { detectKosh } from "@/lib/server/kosh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

/**
 * Pull the latest Kosh from its remote. Fast-forward-only. Refuses to
 * run with a dirty working tree so Kosh mods (rare — Kosh ships as a
 * plugin, users shouldn't need to edit it) don't get stomped.
 *
 * Kosh's default branch is `trunk`, not `main`. We honor whatever
 * branch is currently checked out so Katie's local clone (which is on
 * trunk) works out of the box, and future branch renames don't need a
 * code change here.
 *
 * The existing `maybeUpdateKosh` in kosh.ts auto-runs before every QA
 * run. This route is the manual button — use it when you know a
 * release just landed and don't want to wait for the next audit.
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
  if (!detect.kosh_path) {
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
  const koshPath = detect.kosh_path;
  if (!existsSync(koshPath)) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no-kosh-path",
        message: `Kosh directory not found at ${koshPath}`,
      },
      { status: 404 },
    );
  }

  const git = async (...args: string[]) => {
    // Absolute path to git — matches the Update Smithers route's
    // hardening against stripped PATH in server-action workers.
    return execFileAsync("/usr/bin/git", ["-C", koshPath, ...args]);
  };

  try {
    const branchRes = await git("rev-parse", "--abbrev-ref", "HEAD");
    const branch = branchRes.stdout.trim();

    const statusRes = await git("status", "--porcelain");
    if (statusRes.stdout.trim().length > 0) {
      return NextResponse.json(
        {
          ok: false,
          reason: "dirty-tree",
          message:
            "Kosh clone has uncommitted local changes. Commit or stash them before updating.",
        },
        { status: 409 },
      );
    }

    const beforeRes = await git("rev-parse", "HEAD");
    const beforeSha = beforeRes.stdout.trim();

    await git("fetch", "origin", branch);
    await git("pull", "--ff-only", "origin", branch);

    const afterRes = await git("rev-parse", "HEAD");
    const afterSha = afterRes.stdout.trim();

    if (beforeSha === afterSha) {
      return NextResponse.json({
        ok: true,
        changed: false,
        sha: afterSha.slice(0, 7),
        branch,
        message: "Kosh already up to date.",
      });
    }

    const logRes = await git(
      "log",
      "--oneline",
      "-1",
      "--format=%h %s",
      afterSha,
    );
    const latest = logRes.stdout.trim();

    const countRes = await git(
      "rev-list",
      "--count",
      `${beforeSha}..${afterSha}`,
    );
    const newCommits = Number(countRes.stdout.trim()) || 0;

    return NextResponse.json({
      ok: true,
      changed: true,
      sha: afterSha.slice(0, 7),
      branch,
      latest,
      new_commits: newCommits,
      message: `Pulled ${newCommits} commit${newCommits === 1 ? "" : "s"} onto ${branch}. New Kosh logic takes effect on the next QA run.`,
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

/**
 * Read-only HEAD info so the card can show what version Kosh is on.
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
    const branch = (
      await execFileAsync(
        "/usr/bin/git",
        ["-C", detect.kosh_path, "rev-parse", "--abbrev-ref", "HEAD"],
      )
    ).stdout.trim();
    const head = (
      await execFileAsync(
        "/usr/bin/git",
        [
          "-C",
          detect.kosh_path,
          "log",
          "--oneline",
          "-1",
          "--format=%h %s",
        ],
      )
    ).stdout.trim();
    return NextResponse.json({ ok: true, branch, head });
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
