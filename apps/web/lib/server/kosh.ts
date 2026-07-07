import "server-only";

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { Database as DB } from "better-sqlite3";

import { loadConfig } from "./config";
import { getDb } from "./db";
import { getMcpClient } from "./mcp";
import { getVault } from "./vault";

const execFileAsync = promisify(execFile);

/** Kosh test types — what /kosh:<type> the user can invoke. `aeo` was added in Kosh v2 (PR #10). */
export type QaTestType = "functional-design" | "performance" | "a11y" | "aeo";

/** The environment the URL points at, fed to the kosh skills so they adjust strictness. */
export type QaEnv = "local" | "development" | "staging" | "production";

/** Run lifecycle. queued → running → (completed | failed | cancelled). */
export type QaRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Where the run came from. cli = Smithers-launched subprocess. manual = user ran kosh themselves and Smithers ingested the result. */
export type QaRunSource = "cli" | "manual";

export interface QaRunRow {
  id: string;
  project_slug: string;
  test_type: QaTestType;
  target_url: string;
  env: QaEnv;
  status: QaRunStatus;
  started_at: string;
  completed_at: string | null;
  pid: number | null;
  log_path: string | null;
  report_json_relpath: string | null;
  /** Legacy — Kosh v1 wrote MD; kept null for v2 HTML runs. Read paths accept both. */
  report_md_relpath: string | null;
  /** Kosh v2 emits self-contained HTML instead of MD. Populated for new runs. */
  report_html_relpath: string | null;
  counts_critical: number | null;
  counts_high: number | null;
  counts_medium: number | null;
  counts_low: number | null;
  error_message: string | null;
  /**
   * Structured failure classifier. `gated:coming-soon` |
   * `gated:password` | `gated:private` when Kosh v2's reachability
   * gate check aborts the run; null for generic failures. Detail
   * page keys off this to render a retry-with-Share-Link affordance
   * instead of a raw error dump.
   */
  failure_kind: string | null;
  source: QaRunSource;
}

/** Gate types Kosh v2's reachability check surfaces. */
export type QaGateType = "coming-soon" | "password" | "private";

export interface KoshDetection {
  /** Path to the `claude` CLI on PATH, or null. */
  claude_cli: string | null;
  /** Resolved kosh dir from config.paths.kosh, when present + readable. */
  kosh_path: string | null;
  /** Both above are present — Smithers can launch a run directly. */
  ready: boolean;
  /** Human-readable reason when not ready. */
  reason?: string;
}

export interface StartQaRunInput {
  project_slug: string;
  test_type: QaTestType;
  target_url: string;
  env?: QaEnv;
}

export interface IngestQaRunInput {
  project_slug: string;
  test_type: QaTestType;
  target_url: string;
  env?: QaEnv;
}

const KOSH_TYPE_TO_OUTPUT_FILENAME: Record<QaTestType, string> = {
  "functional-design": "qa-report-functional.json",
  performance: "qa-report-performance.json",
  a11y: "qa-report-accessibility.json",
  aeo: "qa-report-aeo.json",
};

const KOSH_TYPE_TO_REPORT_SCRIPT_FLAG: Record<QaTestType, string> = {
  "functional-design": "--functional",
  performance: "--performance",
  a11y: "--accessibility",
  aeo: "--aeo",
};

/** The folder inside the partner/project HM directory where reports land. */
const HM_REPORTS_FOLDER = "Kosh Reports";

// --- Detection -------------------------------------------------------------

/**
 * Resolve whether Smithers can launch a kosh run on this machine. Looks
 * for the `claude` CLI on PATH and a configured `paths.kosh` directory
 * that actually exists.
 */
export async function detectKosh(): Promise<KoshDetection> {
  const cfg = await loadConfig();
  const koshPath = cfg.paths.kosh
    ? expandHome(cfg.paths.kosh)
    : null;
  const koshExists = koshPath ? existsSync(koshPath) : false;
  let claudeCli: string | null = null;
  try {
    const { stdout } = await execFileAsync("which", ["claude"]);
    const trimmed = stdout.trim();
    if (trimmed.length > 0) claudeCli = trimmed;
  } catch {
    claudeCli = null;
  }

  if (claudeCli && koshExists) {
    return { claude_cli: claudeCli, kosh_path: koshPath, ready: true };
  }
  const reasons: string[] = [];
  if (!claudeCli) reasons.push("`claude` CLI not found on PATH");
  if (!koshExists) {
    reasons.push(
      koshPath
        ? `kosh directory not found at ${koshPath}`
        : "config.paths.kosh is not set",
    );
  }
  return {
    claude_cli: claudeCli,
    kosh_path: koshExists ? koshPath : null,
    ready: false,
    reason: reasons.join(" + "),
  };
}

// --- DB helpers ------------------------------------------------------------

function rowToQaRun(row: Record<string, unknown>): QaRunRow {
  return {
    id: row.id as string,
    project_slug: row.project_slug as string,
    test_type: row.test_type as QaTestType,
    target_url: row.target_url as string,
    env: row.env as QaEnv,
    status: row.status as QaRunStatus,
    started_at: row.started_at as string,
    completed_at: (row.completed_at as string | null) ?? null,
    pid: row.pid === null ? null : Number(row.pid),
    log_path: (row.log_path as string | null) ?? null,
    report_json_relpath: (row.report_json_relpath as string | null) ?? null,
    report_md_relpath: (row.report_md_relpath as string | null) ?? null,
    report_html_relpath: (row.report_html_relpath as string | null) ?? null,
    failure_kind: (row.failure_kind as string | null) ?? null,
    counts_critical:
      row.counts_critical === null ? null : Number(row.counts_critical),
    counts_high: row.counts_high === null ? null : Number(row.counts_high),
    counts_medium:
      row.counts_medium === null ? null : Number(row.counts_medium),
    counts_low: row.counts_low === null ? null : Number(row.counts_low),
    error_message: (row.error_message as string | null) ?? null,
    source: (row.source as QaRunSource) ?? "cli",
  };
}

export async function listQaRuns(projectSlug: string): Promise<QaRunRow[]> {
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT * FROM qa_runs WHERE project_slug = ? ORDER BY started_at DESC`,
    )
    .all(projectSlug) as Record<string, unknown>[];
  return rows.map(rowToQaRun);
}

export async function getQaRun(runId: string): Promise<QaRunRow | null> {
  const db = await getDb();
  const row = db
    .prepare(`SELECT * FROM qa_runs WHERE id = ?`)
    .get(runId) as Record<string, unknown> | undefined;
  return row ? rowToQaRun(row) : null;
}

export async function getActiveQaRun(
  projectSlug: string,
): Promise<QaRunRow | null> {
  const db = await getDb();
  const row = db
    .prepare(
      `SELECT * FROM qa_runs
       WHERE project_slug = ?
         AND status IN ('queued', 'running')
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .get(projectSlug) as Record<string, unknown> | undefined;
  return row ? rowToQaRun(row) : null;
}

/**
 * Pending + running runs for a project, oldest first — feeds the UI's
 * "in progress" panel so the user can see what's queued behind the
 * currently-running test.
 */
export async function listPendingQaRuns(
  projectSlug: string,
): Promise<QaRunRow[]> {
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT * FROM qa_runs
       WHERE project_slug = ?
         AND status IN ('queued', 'running')
       ORDER BY started_at ASC`,
    )
    .all(projectSlug) as Record<string, unknown>[];
  return rows.map(rowToQaRun);
}

// --- Launching a run -------------------------------------------------------

/**
 * Enqueue a kosh QA run. Returns the new run id. Multiple runs can be
 * queued at once (per project or across projects) — the drainQueue()
 * loop runs them strictly one-at-a-time so we don't fight over kosh's
 * hardcoded reports/data/qa-report-<type>.json paths or saturate the
 * machine with parallel Playwright sessions.
 */
export async function startQaRun(
  input: StartQaRunInput,
): Promise<
  | { ok: true; run_id: string; queued_behind: number }
  | {
      ok: false;
      reason: "kosh-not-ready" | "bad-url" | "error";
      message?: string;
    }
> {
  const url = input.target_url.trim();
  if (!/^https?:\/\//.test(url)) {
    return { ok: false, reason: "bad-url", message: "URL must start with http:// or https://" };
  }

  const detect = await detectKosh();
  if (!detect.ready || !detect.claude_cli || !detect.kosh_path) {
    return { ok: false, reason: "kosh-not-ready", message: detect.reason };
  }

  const env = input.env ?? inferEnv(url);
  const runId = randomRunId();
  const cfg = await loadConfig();
  const logDir = join(cfg.paths.data, "kosh-logs");
  await mkdir(logDir, { recursive: true });
  const logPath = join(logDir, `${runId}.log`);

  const db = await getDb();
  db.prepare(
    `INSERT INTO qa_runs (id, project_slug, test_type, target_url, env, status, log_path, source)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, 'cli')`,
  ).run(
    runId,
    input.project_slug,
    input.test_type,
    url,
    env,
    logPath,
  );

  const queuedBehind = countRunsAheadOf(db, runId);
  // Fire and forget — drainQueue is a no-op if something's already running.
  void drainQueue(detect.kosh_path, detect.claude_cli);
  return { ok: true, run_id: runId, queued_behind: queuedBehind };
}

function countRunsAheadOf(db: DB, runId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM qa_runs
       WHERE status IN ('queued', 'running')
         AND id != ?
         AND started_at <= (SELECT started_at FROM qa_runs WHERE id = ?)`,
    )
    .get(runId, runId) as { c: number } | undefined;
  return row?.c ?? 0;
}

/**
 * Atomically promote the oldest queued run to running and spawn the
 * subprocess. Returns immediately if a run is already in flight — we
 * only allow one subprocess at a time.
 *
 * Called on initial enqueue, and again from launchSubprocess's child-
 * exit handler so the queue drains without polling.
 */
let drainInFlight = false;
async function drainQueue(
  koshPath: string,
  claudeCli: string,
): Promise<void> {
  if (drainInFlight) return;
  drainInFlight = true;
  try {
    const db = await getDb();
    const claim = db.transaction(() => {
      const running = db
        .prepare(`SELECT 1 FROM qa_runs WHERE status = 'running' LIMIT 1`)
        .get();
      if (running) return null;
      const next = db
        .prepare(
          `SELECT * FROM qa_runs
           WHERE status = 'queued'
           ORDER BY started_at ASC
           LIMIT 1`,
        )
        .get() as Record<string, unknown> | undefined;
      if (!next) return null;
      // Mark running here so a concurrent drain call sees it. The pid
      // gets written once spawn() actually returns one.
      db.prepare(`UPDATE qa_runs SET status = 'running' WHERE id = ?`).run(
        next.id as string,
      );
      return rowToQaRun(next);
    });

    const claimed = claim();
    if (!claimed) return;

    void launchSubprocess({
      runId: claimed.id,
      koshPath,
      claudeCli,
      testType: claimed.test_type,
      url: claimed.target_url,
      env: claimed.env,
      logPath: claimed.log_path ?? join(
        (await loadConfig()).paths.data,
        "kosh-logs",
        `${claimed.id}.log`,
      ),
      projectSlug: claimed.project_slug,
    }).catch((err) => {
      void recordError(
        claimed.id,
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  } finally {
    drainInFlight = false;
  }
}

async function launchSubprocess(args: {
  runId: string;
  koshPath: string;
  claudeCli: string;
  testType: QaTestType;
  url: string;
  env: QaEnv;
  logPath: string;
  projectSlug: string;
}): Promise<void> {
  const { runId, koshPath, claudeCli, testType, url, env, logPath } = args;

  await writeFile(
    logPath,
    `[${new Date().toISOString()}] starting /kosh:${testType} ${url} (env=${env})\n`,
  );

  // Best-effort `git pull --ff-only` so plugins/skill prompts stay current.
  // Failures (dirty tree, no remote, offline) log but don't block the run.
  await maybeUpdateKosh(koshPath, logPath);

  // Wipe any stale kosh output JSON from a prior run — otherwise a
  // failed run would silently "succeed" against the old file.
  const expectedJson = join(
    koshPath,
    "reports",
    "data",
    KOSH_TYPE_TO_OUTPUT_FILENAME[testType],
  );
  try {
    if (existsSync(expectedJson)) {
      await writeFile(expectedJson, "");
    }
  } catch {
    // best effort — kosh will overwrite anyway
  }

  // Kosh v2's reachability-gate check (a8cteam51/kosh#16) stops when
  // a site is behind Coming Soon / password / private mode and — in
  // unattended mode, which `--print` triggers — exits with a
  // human-readable message. We ask Kosh to emit a machine-readable
  // marker before stopping so the stdout-watcher below picks it up
  // reliably; the fallback regex catches the free-form message when
  // the LLM ignores the instruction.
  const prompt = [
    `/kosh:${testType} ${url} ${env}`,
    "",
    "SMITHERS_HINT: If your reachability-gate check trips (Coming Soon,",
    "password-protected, or private site), print exactly this marker on a",
    "line by itself before stopping — the invoking tool watches for it:",
    "",
    "  [SMITHERS_GATE:coming-soon]  (or :password / :private)",
    "",
    "Then stop with your normal unattended-mode message. Do not attempt",
    "to wait for user input — this is a non-interactive subprocess.",
  ].join("\n");
  // --plugin-dir loads kosh's commands/skills/hooks for this session;
  // --dangerously-skip-permissions pre-approves the Playwright MCP tools
  // (kosh's own .claude/settings.json approves them in an interactive
  // session, but --print doesn't honor those the same way). Prompt is
  // piped via stdin since --print + positional prompt argument can be
  // ambiguous when other flags are present.
  const cliArgs = [
    "--print",
    "--plugin-dir",
    koshPath,
    "--dangerously-skip-permissions",
  ];

  const child = spawn(claudeCli, cliArgs, {
    cwd: koshPath,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  child.stdin?.write(prompt);
  child.stdin?.end();

  // Watch stdout for the gate marker (preferred) or a fallback regex
  // over Kosh's free-form gate-detected language. First hit wins; we
  // stash the classification and let the process complete naturally
  // (Kosh's unattended branch exits promptly on its own).
  let detectedGate: QaGateType | null = null;
  // Also watch for "Unknown command: /kosh:<type>" — happens when the
  // user's Kosh clone is out of date relative to the test types
  // Smithers exposes (e.g. `/kosh:aeo` added in Kosh PR #10). Gives
  // the detail page an actionable "Update Kosh" affordance instead
  // of a raw generic failure.
  let detectedUnknownCommand: string | null = null;

  // Row was already marked running by drainQueue's atomic claim; just
  // stamp the pid now that spawn() has handed one back.
  const db = await getDb();
  db.prepare(`UPDATE qa_runs SET pid = ? WHERE id = ?`).run(
    child.pid ?? null,
    runId,
  );

  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    if (!detectedGate) detectedGate = classifyGate(text);
    if (!detectedUnknownCommand)
      detectedUnknownCommand = classifyUnknownCommand(text);
    void appendLog(logPath, text);
  });
  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    if (!detectedGate) detectedGate = classifyGate(text);
    if (!detectedUnknownCommand)
      detectedUnknownCommand = classifyUnknownCommand(text);
    void appendLog(logPath, text);
  });

  child.on("error", (err) => {
    void appendLog(logPath, `\n[error] ${err.message}\n`);
  });

  child.on("close", async (code, signal) => {
    await appendLog(
      logPath,
      `\n[${new Date().toISOString()}] child exited code=${code} signal=${signal ?? "none"}\n`,
    );
    try {
      // If the row was already marked cancelled, don't overwrite it.
      const cur = await getQaRun(runId);
      if (cur?.status === "cancelled") return;

      // Gate + unknown-command detection always win over the normal
      // exit path: Kosh exits cleanly (code=0) after either, but no
      // report JSON was produced so finalizeSuccess would raise a
      // generic "kosh did not produce X" error. Structured
      // failure_kind lets the detail page render the right
      // recovery card.
      //
      // Each recorder is wrapped in its own try/catch so a DB error
      // (e.g. a schema mismatch on an un-migrated DB) can still fall
      // through to recordError below — otherwise the row stays
      // stuck at `running` and the user sees a phantom in-flight
      // audit forever. This bit Katie's very first gate-detection
      // run: the column didn't exist yet on her installed DB, the
      // update threw, and the run never transitioned out of running.
      let handled = false;
      if (detectedGate) {
        try {
          await recordGateFailure(runId, detectedGate);
          handled = true;
        } catch (err) {
          await appendLog(
            logPath,
            `\n[gate-record-failed] ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
      if (!handled && detectedUnknownCommand) {
        try {
          await recordUnknownCommandFailure(runId, detectedUnknownCommand);
          handled = true;
        } catch (err) {
          await appendLog(
            logPath,
            `\n[unknown-command-record-failed] ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
      if (handled) {
        // Already recorded via one of the structured paths above.
      } else if (code === 0 || code === null) {
        // Success path — pick up the report JSON, push to HM.
        try {
          await finalizeSuccess({
            runId,
            koshPath,
            testType,
            projectSlug: args.projectSlug,
          });
        } catch (err) {
          await recordError(
            runId,
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      } else {
        await recordError(
          runId,
          new Error(`kosh exited with code ${code} signal ${signal ?? "none"}`),
        );
      }
    } finally {
      // Pick up the next queued run, if any. Errors swallowed — the
      // next row stays queued and the user can trigger another start.
      void drainQueue(koshPath, claudeCli).catch(() => undefined);
    }
  });
}

/**
 * `git pull --ff-only` against the kosh clone so commands/skills stay
 * fresh. Skips on a dirty tree (we don't want to fight conflicts) and
 * on a missing remote / offline. Output goes to the run log.
 *
 * Kosh ships as a Claude Code plugin — only its commands/skills/scripts
 * are loaded at runtime, so a successful pull is enough to pick up new
 * test logic. No npm install needed.
 */
async function maybeUpdateKosh(
  koshPath: string,
  logPath: string,
): Promise<void> {
  try {
    const cfg = await loadConfig();
    const result = await syncKoshClone(koshPath, cfg.kosh);
    const summary = result.summary || (result.ok ? "ok" : "failed");
    await appendLog(logPath, `[kosh update] ${summary}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await appendLog(logPath, `[kosh update] skipped — ${msg.split("\n")[0]}\n`);
  }
}

// --- Channel-aware clone sync ---------------------------------------------
//
// Kosh v2 shipped git-tagged releases (v1.0.0, v1.1.0, ...) alongside the
// bleeding-edge `trunk` branch. Smithers respects the config'd channel:
//
//   stable   — latest v*.*.* tag. New users default here so upstream churn
//              doesn't silently break the Smithers integration mid-day.
//   trunk    — track the trunk branch (previous behavior). For Kosh
//              collaborators + power users who want unreleased fixes.
//   pinned   — lock to `pinned_tag` verbatim. When the config's tag is
//              missing / empty, we fall through to trunk behavior so the
//              clone doesn't get stuck on nothing.

export type KoshChannel = "stable" | "trunk" | "pinned";

export interface KoshChannelSpec {
  channel: KoshChannel;
  pinned_tag?: string;
}

interface KoshResolvedTarget {
  kind: "branch" | "tag";
  /** Human name for display / logs. */
  name: string;
  /** Target SHA (from `rev-parse`). */
  ref: string;
}

const GIT_BIN = "/usr/bin/git";

/**
 * Resolve the channel spec to a concrete target (branch or tag) after
 * fetching from origin. When channel === "stable" but no tags exist,
 * or when channel === "pinned" but the tag isn't found, falls back to
 * trunk-style resolution so we always return something usable.
 */
async function resolveKoshTarget(
  koshPath: string,
  spec: KoshChannelSpec,
): Promise<KoshResolvedTarget> {
  const git = (args: string[]) =>
    execFileAsync(GIT_BIN, ["-C", koshPath, ...args], { timeout: 15_000 });

  // Fetch remote refs so `origin/*` and tag SHAs are current.
  await git(["fetch", "--tags", "--prune", "origin"]).catch(() => undefined);

  if (spec.channel === "pinned" && spec.pinned_tag?.trim()) {
    try {
      const { stdout } = await git([
        "rev-parse",
        "--verify",
        `refs/tags/${spec.pinned_tag.trim()}`,
      ]);
      return { kind: "tag", name: spec.pinned_tag.trim(), ref: stdout.trim() };
    } catch {
      // Fall through to trunk if the pinned tag doesn't exist.
    }
  }

  if (spec.channel === "stable") {
    const tag = await latestSemverTag(koshPath).catch(() => null);
    if (tag) return tag;
    // No tags — fall through to trunk-style.
  }

  // Trunk (explicit) or fallback path. The clone's default branch is
  // "trunk" today; ask git for whatever origin/HEAD resolves to so a
  // future rename to "main" doesn't need a code change here.
  const trunk = await resolveDefaultBranch(koshPath).catch(() => "trunk");
  const { stdout } = await git(["rev-parse", `origin/${trunk}`]);
  return { kind: "branch", name: trunk, ref: stdout.trim() };
}

async function latestSemverTag(
  koshPath: string,
): Promise<KoshResolvedTarget | null> {
  const { stdout } = await execFileAsync(GIT_BIN, [
    "-C",
    koshPath,
    "tag",
    "-l",
    "v[0-9]*.[0-9]*.[0-9]*",
  ]);
  const tags = stdout
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  if (tags.length === 0) return null;
  // Semver-sort descending. Simple three-tuple compare is enough for
  // Kosh's release cadence — no pre-release / build metadata yet.
  tags.sort((a, b) => {
    const [ax, ay, az] = a.slice(1).split(".").map(Number) as [number, number, number];
    const [bx, by, bz] = b.slice(1).split(".").map(Number) as [number, number, number];
    if (ax !== bx) return bx - ax;
    if (ay !== by) return by - ay;
    return bz - az;
  });
  const top = tags[0]!;
  const { stdout: sha } = await execFileAsync(GIT_BIN, [
    "-C",
    koshPath,
    "rev-parse",
    `refs/tags/${top}`,
  ]);
  return { kind: "tag", name: top, ref: sha.trim() };
}

async function resolveDefaultBranch(koshPath: string): Promise<string> {
  const { stdout } = await execFileAsync(GIT_BIN, [
    "-C",
    koshPath,
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
  ]);
  // e.g. "refs/remotes/origin/trunk"
  const parts = stdout.trim().split("/");
  return parts[parts.length - 1] ?? "trunk";
}

export interface KoshSyncResult {
  ok: boolean;
  /** Target we resolved to (post-fetch). */
  target: KoshResolvedTarget | null;
  /** SHA the clone is on now. */
  head: string | null;
  /** Did we actually move HEAD? False on no-op / already up to date. */
  changed: boolean;
  /** One-line summary for logs / toast. */
  summary: string;
}

/**
 * Do whatever's needed to get the local clone onto the target the
 * config picks. Fast-forward pull for branch targets, `checkout` for
 * tag targets (detached HEAD is fine — Kosh is loaded as a plugin,
 * we don't need branch semantics). Refuses on tracked-file changes;
 * untracked report artifacts are ignored.
 */
export async function syncKoshClone(
  koshPath: string,
  spec: KoshChannelSpec,
): Promise<KoshSyncResult> {
  const git = (args: string[]) =>
    execFileAsync(GIT_BIN, ["-C", koshPath, ...args], { timeout: 30_000 });

  const dirty = await git(["status", "--porcelain", "-uno"]).then(
    (r) => r.stdout.trim().length > 0,
    () => false,
  );
  if (dirty) {
    return {
      ok: false,
      target: null,
      head: null,
      changed: false,
      summary: "skipped — tracked files have local changes",
    };
  }

  const target = await resolveKoshTarget(koshPath, spec).catch(() => null);
  if (!target) {
    return {
      ok: false,
      target: null,
      head: null,
      changed: false,
      summary: "skipped — couldn't resolve channel target",
    };
  }

  const beforeSha = await git(["rev-parse", "HEAD"]).then(
    (r) => r.stdout.trim(),
    () => "",
  );

  if (beforeSha === target.ref) {
    return {
      ok: true,
      target,
      head: beforeSha,
      changed: false,
      summary: `already on ${target.kind === "tag" ? target.name : `${target.name} @ ${beforeSha.slice(0, 7)}`}`,
    };
  }

  try {
    if (target.kind === "tag") {
      // Detached checkout — quiet the advice noise.
      await git([
        "-c",
        "advice.detachedHead=false",
        "checkout",
        target.name,
      ]);
    } else {
      // On the right branch? If not, check it out first.
      const currentBranch = await git(["rev-parse", "--abbrev-ref", "HEAD"]).then(
        (r) => r.stdout.trim(),
        () => "",
      );
      if (currentBranch !== target.name) {
        await git(["checkout", target.name]);
      }
      await git(["pull", "--ff-only", "origin", target.name]);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0]! : String(err);
    return {
      ok: false,
      target,
      head: beforeSha,
      changed: false,
      summary: `failed — ${msg}`,
    };
  }

  const afterSha = await git(["rev-parse", "HEAD"]).then(
    (r) => r.stdout.trim(),
    () => "",
  );
  const label = target.kind === "tag" ? target.name : `${target.name} @ ${afterSha.slice(0, 7)}`;
  return {
    ok: true,
    target,
    head: afterSha,
    changed: afterSha !== beforeSha,
    summary: `moved to ${label}`,
  };
}

/**
 * Read the clone's current channel state + resolvable versions. Used
 * by the Update Kosh card + a hypothetical channel-switcher UI.
 */
export interface KoshCloneStatus {
  branch: string;
  head_sha: string;
  head_oneline: string;
  current_tag: string | null;
  available_tags: string[];
  latest_tag: string | null;
}

export async function getKoshCloneStatus(
  koshPath: string,
): Promise<KoshCloneStatus> {
  const git = (args: string[]) =>
    execFileAsync(GIT_BIN, ["-C", koshPath, ...args]);

  const [branch, headSha, headLine] = await Promise.all([
    git(["rev-parse", "--abbrev-ref", "HEAD"]).then((r) => r.stdout.trim()),
    git(["rev-parse", "HEAD"]).then((r) => r.stdout.trim()),
    git(["log", "--oneline", "-1", "--format=%h %s"]).then((r) => r.stdout.trim()),
  ]);

  const currentTag = await git(["describe", "--tags", "--exact-match", "HEAD"])
    .then((r) => r.stdout.trim() || null)
    .catch(() => null);

  const tagsRaw = await git(["tag", "-l", "v[0-9]*.[0-9]*.[0-9]*"])
    .then((r) => r.stdout)
    .catch(() => "");
  const availableTags = tagsRaw
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
  availableTags.sort((a, b) => {
    const [ax, ay, az] = a.slice(1).split(".").map(Number) as [number, number, number];
    const [bx, by, bz] = b.slice(1).split(".").map(Number) as [number, number, number];
    if (ax !== bx) return bx - ax;
    if (ay !== by) return by - ay;
    return bz - az;
  });

  return {
    branch,
    head_sha: headSha,
    head_oneline: headLine,
    current_tag: currentTag,
    available_tags: availableTags,
    latest_tag: availableTags[0] ?? null,
  };
}

async function appendLog(logPath: string, text: string): Promise<void> {
  try {
    await appendFile(logPath, text);
  } catch {
    // disk full / log gone — swallow, status row is the source of truth
  }
}

async function recordError(runId: string, err: Error): Promise<void> {
  const db = await getDb();
  db.prepare(
    `UPDATE qa_runs SET status = 'failed', completed_at = datetime('now'), error_message = ? WHERE id = ?`,
  ).run(err.message.slice(0, 2000), runId);
}

/**
 * Persist a gate-detected failure with a structured `failure_kind` the
 * detail page can key off. The friendly `error_message` lets the log
 * pane show a coherent one-liner alongside the run's actual Kosh
 * output.
 */
async function recordGateFailure(
  runId: string,
  gate: QaGateType,
): Promise<void> {
  const label = GATE_LABEL[gate];
  const db = await getDb();
  db.prepare(
    `UPDATE qa_runs
       SET status = 'failed',
           completed_at = datetime('now'),
           error_message = ?,
           failure_kind = ?
     WHERE id = ?`,
  ).run(
    `Site is behind a ${label} gate. Kosh needs access to audit — retry with a WordPress.com Share Link.`,
    `gated:${gate}`,
    runId,
  );
}

const GATE_LABEL: Record<QaGateType, string> = {
  "coming-soon": "Coming Soon",
  password: "password",
  private: "private-site",
};

/**
 * Persist an unknown-command failure so the detail page can render
 * the "Update Kosh" recovery card. The command slug (e.g. "aeo") is
 * stored in `failure_kind` so the UI can name it back to the user.
 */
async function recordUnknownCommandFailure(
  runId: string,
  command: string,
): Promise<void> {
  const db = await getDb();
  db.prepare(
    `UPDATE qa_runs
       SET status = 'failed',
           completed_at = datetime('now'),
           error_message = ?,
           failure_kind = ?
     WHERE id = ?`,
  ).run(
    `Kosh doesn't recognize /kosh:${command} — your Kosh clone is out of date.`,
    `unknown-command:${command}`,
    runId,
  );
}

/**
 * Match Claude Code's "Unknown command: /kosh:<slug>" output when
 * Kosh's clone hasn't been updated to include a command Smithers is
 * invoking. Simple regex — Claude's error message is stable.
 */
function classifyUnknownCommand(text: string): string | null {
  const m = /unknown command:\s*\/kosh:(\S+)/i.exec(text);
  return m ? m[1]! : null;
}

/**
 * Classify a stdout chunk as a gate-detection event. Prefers the
 * machine-readable marker Smithers asks Kosh to emit; falls back to a
 * pass over Kosh's free-form language for the three supported gates
 * so an LLM that ignores the marker still lands us in the right
 * failure card.
 *
 * Order matters in the fallback: "private" appears in some
 * password-prompt copy ("private site password") so we check it after
 * password. Coming-soon has the most unique lexicon and goes first.
 */
function classifyGate(text: string): QaGateType | null {
  const marker = /\[SMITHERS_GATE:(coming-soon|password|private)\]/i.exec(text);
  if (marker) return marker[1]!.toLowerCase() as QaGateType;
  if (/coming[-\s]soon/i.test(text)) return "coming-soon";
  if (/password[-\s]protected|password prompt|enter (?:the )?site password/i.test(text)) {
    return "password";
  }
  if (/private[-\s]?site|private[-\s]?login|"Private Site"/i.test(text)) {
    return "private";
  }
  // Generic "site is gated" without an obvious type — surface as
  // coming-soon by convention (most common gate); the UI text is
  // still useful for the user.
  if (/site is gated|reachability gate/i.test(text)) return "coming-soon";
  return null;
}

// --- Finalize -------------------------------------------------------------

async function finalizeSuccess(args: {
  runId: string;
  koshPath: string;
  testType: QaTestType;
  projectSlug: string;
}): Promise<void> {
  const { runId, koshPath, testType, projectSlug } = args;
  const json = await readKoshReportJson(koshPath, testType);
  if (!json) {
    throw new Error(
      `kosh did not produce ${KOSH_TYPE_TO_OUTPUT_FILENAME[testType]} — check log for errors`,
    );
  }

  const rendered = await generateReport(koshPath, testType).catch(() => null);
  await uploadAndStamp({
    runId,
    projectSlug,
    testType,
    json,
    rendered,
  });
}

async function readKoshReportJson(
  koshPath: string,
  testType: QaTestType,
): Promise<unknown | null> {
  const p = join(
    koshPath,
    "reports",
    "data",
    KOSH_TYPE_TO_OUTPUT_FILENAME[testType],
  );
  try {
    const raw = await readFile(p, "utf-8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export interface RenderedReport {
  /** Extension of the file we found — `html` for Kosh v2, `md` for legacy v1 runs. */
  ext: "html" | "md";
  /** Full file body. */
  body: string;
}

/**
 * Read the most recently-written report off disk. Kosh v2 emits
 * self-contained HTML (`<NAME>_<TYPE>_QA_REPORT_<DATE>.html`)
 * directly from its SKILL's Phase 5, so we don't strictly need the
 * bundled `run-qa-report.sh` wrapper anymore. We still invoke it
 * best-effort for backward compat with Kosh v1 clones (which wrote
 * only JSON — the wrapper generated the report). If it fails
 * (e.g. `--aeo` isn't in Kosh's shell wrapper's TEST_TYPE_LABEL
 * lookup, so its post-check for the expected filename miscarries),
 * we swallow and fall through — the SKILL almost certainly already
 * wrote what we need. Scan for HTML first, fall back to `.md` for
 * mixed-clone edge cases (updated Kosh code but old MD files still
 * on disk from prior runs).
 */
async function generateReport(
  koshPath: string,
  testType: QaTestType,
): Promise<RenderedReport | null> {
  const script = join(koshPath, "scripts", "run-qa-report.sh");
  if (existsSync(script)) {
    const jsonPath = join(
      "reports",
      "data",
      KOSH_TYPE_TO_OUTPUT_FILENAME[testType],
    );
    const flag = KOSH_TYPE_TO_REPORT_SCRIPT_FLAG[testType];
    try {
      await execFileAsync("bash", [script, jsonPath, flag], {
        cwd: koshPath,
        timeout: 30_000,
      });
    } catch {
      // Non-fatal — the SKILL likely already wrote the report file
      // during its own Phase 5. Continue to the directory scan.
    }
  }
  return await readLatestReportFile(join(koshPath, "reports"));
}

async function readLatestReportFile(
  reportsDir: string,
): Promise<RenderedReport | null> {
  try {
    const entries = await readdir(reportsDir, { withFileTypes: true });
    const candidates = await Promise.all(
      entries
        .filter(
          (e) =>
            e.isFile() &&
            (e.name.endsWith(".html") || e.name.endsWith(".md")),
        )
        .map(async (e) => {
          const full = join(reportsDir, e.name);
          const s = await stat(full);
          return {
            path: full,
            mtime: s.mtimeMs,
            ext: e.name.endsWith(".html") ? ("html" as const) : ("md" as const),
          };
        }),
    );
    if (candidates.length === 0) return null;
    // Prefer HTML when a same-timestamp pair exists; otherwise most-recent
    // wins. Simplest signal: sort HTML above MD when mtime is very close
    // (within 5 seconds).
    candidates.sort((a, b) => {
      const dt = b.mtime - a.mtime;
      if (Math.abs(dt) < 5_000 && a.ext !== b.ext) {
        return a.ext === "html" ? -1 : 1;
      }
      return dt;
    });
    const winner = candidates[0]!;
    const body = await readFile(winner.path, "utf-8");
    return { ext: winner.ext, body };
  } catch {
    return null;
  }
}

/**
 * Push JSON + MD into Hive Mind under `<partner>/<project>/Kosh Reports/`
 * with a date-stamped filename so multiple runs accumulate. Updates the
 * DB row with the final status + count summary so the UI can render the
 * history without re-reading HM.
 */
async function uploadAndStamp(args: {
  runId: string;
  projectSlug: string;
  testType: QaTestType;
  json: unknown;
  rendered: RenderedReport | null;
}): Promise<void> {
  const { runId, projectSlug, testType, json, rendered } = args;
  const vault = await getVault();
  const project = await vault.readProject(projectSlug);
  if (!project) throw new Error(`Project "${projectSlug}" not found in vault`);
  const partnerSlug =
    project.hive_mind_partner_slug ?? project.partner ?? null;
  const projectSlugHm = project.hive_mind_project_slug ?? project.slug;
  if (!partnerSlug) {
    throw new Error(
      `Project "${projectSlug}" is not linked to a Hive Mind partner — set hive_mind_partner_slug or partner in frontmatter`,
    );
  }

  const stamp = stampForFilename(new Date());
  const baseName = `${stamp}-${testType}`;
  const jsonRel = `${HM_REPORTS_FOLDER}/${baseName}.json`;
  const renderedRel = rendered
    ? `${HM_REPORTS_FOLDER}/${baseName}.${rendered.ext}`
    : null;

  const mcp = await getMcpClient();
  await mcp.hiveMind.writeProjectFile(
    partnerSlug,
    projectSlugHm,
    jsonRel,
    JSON.stringify(json, null, 2) + "\n",
  );
  if (rendered && renderedRel) {
    await mcp.hiveMind.writeProjectFile(
      partnerSlug,
      projectSlugHm,
      renderedRel,
      rendered.body,
    );
  }
  await mcp.hiveMind
    .commit(`kosh: ${testType} report ${baseName} for ${partnerSlug}/${projectSlugHm}`)
    .catch(() => undefined);

  const counts = extractIssueCounts(json);
  const db = await getDb();
  const htmlRel = rendered?.ext === "html" ? renderedRel : null;
  const mdRel = rendered?.ext === "md" ? renderedRel : null;
  db.prepare(
    `UPDATE qa_runs
       SET status = 'completed',
           completed_at = datetime('now'),
           report_json_relpath = ?,
           report_md_relpath = ?,
           report_html_relpath = ?,
           counts_critical = ?,
           counts_high = ?,
           counts_medium = ?,
           counts_low = ?
       WHERE id = ?`,
  ).run(
    jsonRel,
    mdRel,
    htmlRel,
    counts.critical,
    counts.high,
    counts.medium,
    counts.low,
    runId,
  );
}

function extractIssueCounts(json: unknown): {
  critical: number;
  high: number;
  medium: number;
  low: number;
} {
  if (!json || typeof json !== "object") {
    return { critical: 0, high: 0, medium: 0, low: 0 };
  }
  const issues = (json as Record<string, unknown>).issues;
  if (!issues || typeof issues !== "object") {
    return { critical: 0, high: 0, medium: 0, low: 0 };
  }
  const i = issues as Record<string, unknown>;
  return {
    critical: Array.isArray(i.critical) ? i.critical.length : 0,
    high: Array.isArray(i.high) ? i.high.length : 0,
    medium: Array.isArray(i.medium) ? i.medium.length : 0,
    low: Array.isArray(i.low) ? i.low.length : 0,
  };
}

// --- Cancel ----------------------------------------------------------------

export async function cancelQaRun(runId: string): Promise<boolean> {
  const run = await getQaRun(runId);
  if (!run) return false;
  if (run.status !== "running" && run.status !== "queued") return false;
  if (run.pid) {
    try {
      process.kill(run.pid, "SIGTERM");
    } catch {
      // already dead — fine
    }
  }
  const db = await getDb();
  db.prepare(
    `UPDATE qa_runs SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?`,
  ).run(runId);
  return true;
}

// --- Ingest (fallback path) ------------------------------------------------

/**
 * Fallback for when Smithers can't launch kosh itself. User runs the
 * `/kosh:<type> <url>` command in a separate Claude session, then comes
 * back here. We pick up the freshly-written JSON in `<kosh>/reports/data/`,
 * validate it, and push to HM as a manual run.
 */
export async function ingestQaRun(
  input: IngestQaRunInput,
): Promise<
  | { ok: true; run_id: string }
  | {
      ok: false;
      reason: "no-kosh-path" | "no-report" | "stale-report" | "error";
      message?: string;
    }
> {
  const cfg = await loadConfig();
  const koshPath = cfg.paths.kosh ? expandHome(cfg.paths.kosh) : null;
  if (!koshPath || !existsSync(koshPath)) {
    return { ok: false, reason: "no-kosh-path" };
  }
  const jsonPath = join(
    koshPath,
    "reports",
    "data",
    KOSH_TYPE_TO_OUTPUT_FILENAME[input.test_type],
  );
  if (!existsSync(jsonPath)) {
    return {
      ok: false,
      reason: "no-report",
      message: `Expected ${jsonPath} to exist`,
    };
  }
  const s = await stat(jsonPath);
  const ageMs = Date.now() - s.mtimeMs;
  if (ageMs > 24 * 60 * 60 * 1000) {
    return {
      ok: false,
      reason: "stale-report",
      message: `Report at ${jsonPath} is older than 24h — re-run kosh before ingesting`,
    };
  }
  const json = JSON.parse(await readFile(jsonPath, "utf-8")) as unknown;
  const rendered = await generateReport(koshPath, input.test_type).catch(
    () => null,
  );

  const runId = randomRunId();
  const env = input.env ?? inferEnv(input.target_url);
  const db = await getDb();
  db.prepare(
    `INSERT INTO qa_runs (id, project_slug, test_type, target_url, env, status, started_at, source)
     VALUES (?, ?, ?, ?, ?, 'running', ?, 'manual')`,
  ).run(
    runId,
    input.project_slug,
    input.test_type,
    input.target_url.trim(),
    env,
    new Date(s.mtimeMs).toISOString(),
  );

  try {
    await uploadAndStamp({
      runId,
      projectSlug: input.project_slug,
      testType: input.test_type,
      json,
      rendered,
    });
  } catch (err) {
    await recordError(
      runId,
      err instanceof Error ? err : new Error(String(err)),
    );
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, run_id: runId };
}

// --- HM read for detail view ----------------------------------------------

export async function readQaRunReport(
  runId: string,
): Promise<{
  run: QaRunRow;
  json: unknown | null;
  md: string | null;
  html: string | null;
  log: string | null;
} | null> {
  const run = await getQaRun(runId);
  if (!run) return null;

  const cfg = await loadConfig();
  const hivePath = cfg.paths.hive_mind ? expandHome(cfg.paths.hive_mind) : null;

  const vault = await getVault();
  const project = await vault.readProject(run.project_slug);
  const partnerSlug =
    project?.hive_mind_partner_slug ?? project?.partner ?? null;
  const projectSlugHm = project?.hive_mind_project_slug ?? project?.slug ?? null;

  const tryRead = async (rel: string | null): Promise<string | null> => {
    if (!rel || !hivePath || !partnerSlug || !projectSlugHm) return null;
    const abs = hmProjectAbsPath(hivePath, partnerSlug, projectSlugHm, rel);
    try {
      return await readFile(abs, "utf-8");
    } catch {
      return null;
    }
  };

  const [jsonRaw, md, html] = await Promise.all([
    tryRead(run.report_json_relpath),
    tryRead(run.report_md_relpath),
    tryRead(run.report_html_relpath),
  ]);
  let json: unknown | null = null;
  if (jsonRaw) {
    try {
      json = JSON.parse(jsonRaw);
    } catch {
      json = null;
    }
  }

  let log: string | null = null;
  if (run.log_path) {
    try {
      log = await readFile(run.log_path, "utf-8");
    } catch {
      log = null;
    }
  }

  return { run, json, md, html, log };
}

/**
 * Resolve a completed QA run to its on-disk absolute paths inside the
 * Hive Mind clone. Used by the detail page's "Open in vault" / "Copy
 * path" affordances so the TAM can grab the markdown directly for
 * pasting into Linear or sharing externally.
 */
export async function getQaRunVaultPaths(
  runId: string,
): Promise<{
  json_abs_path: string | null;
  md_abs_path: string | null;
  html_abs_path: string | null;
} | null> {
  const run = await getQaRun(runId);
  if (!run) return null;
  const cfg = await loadConfig();
  const hivePath = cfg.paths.hive_mind ? expandHome(cfg.paths.hive_mind) : null;
  const vault = await getVault();
  const project = await vault.readProject(run.project_slug);
  const partnerSlug =
    project?.hive_mind_partner_slug ?? project?.partner ?? null;
  const projectSlugHm = project?.hive_mind_project_slug ?? project?.slug ?? null;
  if (!hivePath || !partnerSlug || !projectSlugHm) {
    return { json_abs_path: null, md_abs_path: null, html_abs_path: null };
  }
  return {
    json_abs_path: run.report_json_relpath
      ? hmProjectAbsPath(hivePath, partnerSlug, projectSlugHm, run.report_json_relpath)
      : null,
    md_abs_path: run.report_md_relpath
      ? hmProjectAbsPath(hivePath, partnerSlug, projectSlugHm, run.report_md_relpath)
      : null,
    html_abs_path: run.report_html_relpath
      ? hmProjectAbsPath(hivePath, partnerSlug, projectSlugHm, run.report_html_relpath)
      : null,
  };
}

// --- helpers ---------------------------------------------------------------

function hmProjectAbsPath(
  hivePath: string,
  partnerSlug: string,
  projectSlugHm: string,
  relPath: string,
): string {
  // HM project files live at:
  //   <hive>/knowledge/partners/<partner>/<project>/<file>
  // (no `projects/` intermediate segment — that was an earlier bug here
  // and is the reason the JSON download 404'd.)
  return join(
    hivePath,
    "knowledge",
    "partners",
    partnerSlug,
    projectSlugHm,
    relPath,
  );
}

function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return p;
}

function inferEnv(url: string): QaEnv {
  const lower = url.toLowerCase();
  if (lower.includes(".test") || lower.includes(".local") || lower.includes("localhost")) {
    return "local";
  }
  if (lower.includes("staging.") || lower.includes("-staging.")) return "staging";
  if (lower.includes("dev.") || lower.includes("development.")) return "development";
  return "production";
}

function randomRunId(): string {
  return `qa_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function stampForFilename(d: Date): string {
  // YYYY-MM-DD-HHmm (local time) — sorts lexically by chronology.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}${mi}`;
}

