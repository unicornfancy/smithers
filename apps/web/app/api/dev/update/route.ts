import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

import { findRepoRoot } from "@/lib/server/config-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

/**
 * Pull the latest Smithers from origin/main. Refuses to run when the
 * working tree has uncommitted changes (so a user's WIP doesn't get
 * stomped or rebased into a mess) and when the current branch isn't
 * main (so we don't accidentally fast-forward a feature branch into
 * trunk). After the pull, the response reports whether package.json
 * or pnpm-lock.yaml moved — the UI uses that to recommend `pnpm
 * install` + a dev-server restart.
 *
 * Dev-only: a production Smithers wouldn't be running `git pull` from
 * inside itself. The /api/dev/restart sibling has the same guard.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        reason: "production",
        message: "Update is only available in development.",
      },
      { status: 403 },
    );
  }

  const repoRoot = findRepoRoot();
  if (!existsSync(repoRoot)) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no-repo-root",
        message: `Could not find repo root at ${repoRoot}`,
      },
      { status: 500 },
    );
  }

  const git = async (...args: string[]) => {
    // Always use /usr/bin/git so a stripped PATH on the server-action
    // worker doesn't blow up the spawn (same class of bug as the gh
    // CLI shell-out — see kosh-findings.ts).
    return execFileAsync("/usr/bin/git", args, { cwd: repoRoot });
  };

  try {
    const branchRes = await git("rev-parse", "--abbrev-ref", "HEAD");
    const branch = branchRes.stdout.trim();
    if (branch !== "main") {
      return NextResponse.json(
        {
          ok: false,
          reason: "wrong-branch",
          message: `Currently on '${branch}'. Switch to main before updating.`,
        },
        { status: 409 },
      );
    }

    const statusRes = await git("status", "--porcelain");
    if (statusRes.stdout.trim().length > 0) {
      return NextResponse.json(
        {
          ok: false,
          reason: "dirty-tree",
          message:
            "Uncommitted local changes. Commit or stash them before updating so nothing gets lost.",
        },
        { status: 409 },
      );
    }

    const beforeRes = await git("rev-parse", "HEAD");
    const beforeSha = beforeRes.stdout.trim();

    await git("fetch", "origin", "main");
    await git("pull", "--rebase", "--ff-only", "origin", "main");

    const afterRes = await git("rev-parse", "HEAD");
    const afterSha = afterRes.stdout.trim();

    if (beforeSha === afterSha) {
      return NextResponse.json({
        ok: true,
        changed: false,
        sha: afterSha.slice(0, 7),
        message: "Already up to date.",
      });
    }

    // What changed between the two commits — drives the "install +
    // restart" recommendation in the UI.
    const diffRes = await git("diff", "--name-only", beforeSha, afterSha);
    const changedFiles = diffRes.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const depsChanged = changedFiles.some(
      (f) =>
        f === "package.json" ||
        f === "pnpm-lock.yaml" ||
        f.endsWith("/package.json"),
    );

    // Latest commit subject so the user sees something concrete.
    const logRes = await git(
      "log",
      "--oneline",
      "-1",
      "--format=%h %s",
      afterSha,
    );
    const latest = logRes.stdout.trim();

    // Count of new commits applied.
    const countRes = await git("rev-list", "--count", `${beforeSha}..${afterSha}`);
    const newCommits = Number(countRes.stdout.trim()) || 0;

    return NextResponse.json({
      ok: true,
      changed: true,
      sha: afterSha.slice(0, 7),
      latest,
      new_commits: newCommits,
      deps_changed: depsChanged,
      message: depsChanged
        ? `Pulled ${newCommits} commit${newCommits === 1 ? "" : "s"}. Dependencies changed — run pnpm install + restart.`
        : `Pulled ${newCommits} commit${newCommits === 1 ? "" : "s"}. Restart to apply.`,
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
 * Read-only HEAD info for the card's "Current version" line.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, reason: "production" },
      { status: 403 },
    );
  }
  const repoRoot = findRepoRoot();
  if (!existsSync(repoRoot)) {
    return NextResponse.json(
      { ok: false, reason: "no-repo-root" },
      { status: 500 },
    );
  }
  try {
    const branch = (
      await execFileAsync("/usr/bin/git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repoRoot,
      })
    ).stdout.trim();
    const head = (
      await execFileAsync(
        "/usr/bin/git",
        ["log", "--oneline", "-1", "--format=%h %s"],
        { cwd: repoRoot },
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
