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

/** Kosh test types — what /kosh:<type> the user can invoke. */
export type QaTestType = "functional-design" | "performance" | "a11y";

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
  report_md_relpath: string | null;
  counts_critical: number | null;
  counts_high: number | null;
  counts_medium: number | null;
  counts_low: number | null;
  error_message: string | null;
  source: QaRunSource;
}

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
};

const KOSH_TYPE_TO_REPORT_SCRIPT_FLAG: Record<QaTestType, string> = {
  "functional-design": "--functional",
  performance: "--performance",
  a11y: "--accessibility",
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

  const prompt = `/kosh:${testType} ${url} ${env}`;
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

  // Row was already marked running by drainQueue's atomic claim; just
  // stamp the pid now that spawn() has handed one back.
  const db = await getDb();
  db.prepare(`UPDATE qa_runs SET pid = ? WHERE id = ?`).run(
    child.pid ?? null,
    runId,
  );

  child.stdout?.on("data", (chunk) => {
    void appendLog(logPath, chunk.toString());
  });
  child.stderr?.on("data", (chunk) => {
    void appendLog(logPath, chunk.toString());
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

      if (code === 0 || code === null) {
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
    const { stdout: status } = await execFileAsync(
      "git",
      ["-C", koshPath, "status", "--porcelain"],
      { timeout: 5_000 },
    );
    if (status.trim().length > 0) {
      await appendLog(
        logPath,
        `[kosh update] skipped — working tree has local changes\n`,
      );
      return;
    }
    const { stdout: pullOut, stderr: pullErr } = await execFileAsync(
      "git",
      ["-C", koshPath, "pull", "--ff-only"],
      { timeout: 15_000 },
    );
    const summary = (pullOut || pullErr || "").trim().split("\n").slice(0, 4).join(" | ");
    await appendLog(logPath, `[kosh update] ${summary || "ok"}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await appendLog(logPath, `[kosh update] skipped — ${msg.split("\n")[0]}\n`);
  }
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

  const md = await generateMarkdownReport(koshPath, testType).catch(() => null);
  await uploadAndStamp({
    runId,
    projectSlug,
    testType,
    json,
    md,
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

/**
 * Invoke kosh's bundled run-qa-report.sh to convert JSON → Markdown.
 * Returns the rendered MD or null when the script isn't there / fails.
 * The script always writes the MD to `reports/<UPPER>_<TYPE>_QA_REPORT_<DATE>.md`
 * — we then read that file off disk.
 */
async function generateMarkdownReport(
  koshPath: string,
  testType: QaTestType,
): Promise<string | null> {
  const script = join(koshPath, "scripts", "run-qa-report.sh");
  if (!existsSync(script)) return null;
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
    return null;
  }
  // Find the most recently written .md in reports/
  const reportsDir = join(koshPath, "reports");
  try {
    const entries = await readdir(reportsDir, { withFileTypes: true });
    const mdFiles = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map(async (e) => {
          const full = join(reportsDir, e.name);
          const s = await stat(full);
          return { path: full, mtime: s.mtimeMs };
        }),
    );
    if (mdFiles.length === 0) return null;
    mdFiles.sort((a, b) => b.mtime - a.mtime);
    return await readFile(mdFiles[0]!.path, "utf-8");
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
  md: string | null;
}): Promise<void> {
  const { runId, projectSlug, testType, json, md } = args;
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
  const mdRel = `${HM_REPORTS_FOLDER}/${baseName}.md`;

  const mcp = await getMcpClient();
  await mcp.hiveMind.writeProjectFile(
    partnerSlug,
    projectSlugHm,
    jsonRel,
    JSON.stringify(json, null, 2) + "\n",
  );
  if (md) {
    await mcp.hiveMind.writeProjectFile(
      partnerSlug,
      projectSlugHm,
      mdRel,
      md,
    );
  }
  await mcp.hiveMind
    .commit(`kosh: ${testType} report ${baseName} for ${partnerSlug}/${projectSlugHm}`)
    .catch(() => undefined);

  const counts = extractIssueCounts(json);
  const db = await getDb();
  db.prepare(
    `UPDATE qa_runs
       SET status = 'completed',
           completed_at = datetime('now'),
           report_json_relpath = ?,
           report_md_relpath = ?,
           counts_critical = ?,
           counts_high = ?,
           counts_medium = ?,
           counts_low = ?
       WHERE id = ?`,
  ).run(
    jsonRel,
    md ? mdRel : null,
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
  const md = await generateMarkdownReport(koshPath, input.test_type).catch(
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
      md,
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
    const abs = join(
      hivePath,
      "knowledge",
      "partners",
      partnerSlug,
      "projects",
      projectSlugHm,
      rel,
    );
    try {
      return await readFile(abs, "utf-8");
    } catch {
      return null;
    }
  };

  const [jsonRaw, md] = await Promise.all([
    tryRead(run.report_json_relpath),
    tryRead(run.report_md_relpath),
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

  return { run, json, md, log };
}

// --- helpers ---------------------------------------------------------------

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

