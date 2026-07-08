import "server-only";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

import { loadConfig } from "./config";
import { getDb } from "./db";
import { getVault } from "./vault";

/**
 * Team51 CLI integration — Terminal-launched flow.
 *
 * The team51 CLI is a Symfony Console PHP app that reads/writes to
 * external tools (op, gh, Automattic APIs) which authenticate against
 * per-shell process ancestry. Running the CLI as a Node subprocess
 * from Smithers's dev server fails because Node isn't in 1Password's
 * trusted ancestry chain (see git log for the ~30-message debugging
 * epic that led us here).
 *
 * The design that works: Smithers COMPOSES the exact command from a
 * web form, writes a shell script that runs it + POSTs the log back,
 * then AppleScripts Terminal.app to open the script. The CLI runs
 * with a real Terminal ancestor, all interactive prompts (Symfony's
 * confirmation, `op`'s biometric) happen naturally, and when the
 * script finishes it curls the log + exit code back to Smithers.
 * Smithers parses the log for structured results (new site URLs)
 * and offers to write them into project frontmatter.
 *
 * Trade-offs vs. the old subprocess design:
 *   ✓ Works with 1Password's ancestry-based auth on every restart.
 *   ✓ Matches the terminal workflow existing TAMs already know.
 *   ✓ No `--no-interaction`; CLI prompts / errors surface inline.
 *   ✗ No live log tail in Smithers during the run — the user
 *     watches the terminal window. Detail page shows the log once
 *     the postback fires.
 *   ✗ First AppleScript invocation prompts for macOS Automation
 *     permission (one-time).
 *   ✗ macOS-only (Smithers is macOS-only anyway).
 */

// --- Types -----------------------------------------------------------------

export type Team51CommandSlug =
  | "wpcom:create-site"
  | "pressable:create-site"
  | "pressable:clone-site"
  | "wpcom:run-site-wp-cli-command"
  | "pressable:run-site-wp-cli-command";

export type Team51CommandGroup = "wpcom" | "pressable" | "github" | "deployhq";

export type Team51RunStatus =
  | "queued" // Script written, Terminal launch pending / in flight
  | "running" // Running in Terminal, awaiting postback
  | "completed"
  | "failed"
  | "cancelled";

export interface Team51RunRow {
  id: string;
  project_slug: string;
  command: Team51CommandSlug;
  command_group: Team51CommandGroup;
  args_json: string;
  status: Team51RunStatus;
  started_at: string;
  completed_at: string | null;
  pid: number | null;
  exit_code: number | null;
  log_path: string | null;
  failure_kind: string | null;
  error_message: string | null;
  result_json: string | null;
  postback_token: string | null;
  captured_url: string | null;
}

export interface Team51PublicRunRow {
  id: string;
  project_slug: string;
  command: Team51CommandSlug;
  command_group: Team51CommandGroup;
  status: Team51RunStatus;
  started_at: string;
  completed_at: string | null;
  exit_code: number | null;
  captured_url: string | null;
  failure_kind: string | null;
}

// --- DB helpers ------------------------------------------------------------

function rowToTeam51Run(row: Record<string, unknown>): Team51RunRow {
  return {
    id: String(row["id"]),
    project_slug: String(row["project_slug"]),
    command: row["command"] as Team51CommandSlug,
    command_group: row["command_group"] as Team51CommandGroup,
    args_json: String(row["args_json"] ?? "[]"),
    status: row["status"] as Team51RunStatus,
    started_at: String(row["started_at"]),
    completed_at: (row["completed_at"] as string | null) ?? null,
    pid: (row["pid"] as number | null) ?? null,
    exit_code: (row["exit_code"] as number | null) ?? null,
    log_path: (row["log_path"] as string | null) ?? null,
    failure_kind: (row["failure_kind"] as string | null) ?? null,
    error_message: (row["error_message"] as string | null) ?? null,
    result_json: (row["result_json"] as string | null) ?? null,
    postback_token: (row["postback_token"] as string | null) ?? null,
    captured_url: (row["captured_url"] as string | null) ?? null,
  };
}

/** Strip `postback_token` — it's a secret and shouldn't reach clients. */
export function toPublicRow(row: Team51RunRow): Team51PublicRunRow {
  return {
    id: row.id,
    project_slug: row.project_slug,
    command: row.command,
    command_group: row.command_group,
    status: row.status,
    started_at: row.started_at,
    completed_at: row.completed_at,
    exit_code: row.exit_code,
    captured_url: row.captured_url,
    failure_kind: row.failure_kind,
  };
}

export async function getTeam51Run(runId: string): Promise<Team51RunRow | null> {
  const db = await getDb();
  const row = db
    .prepare(`SELECT * FROM team51_runs WHERE id = ?`)
    .get(runId) as Record<string, unknown> | undefined;
  return row ? rowToTeam51Run(row) : null;
}

export async function listTeam51RunsForProject(
  projectSlug: string,
  limit = 20,
): Promise<Team51PublicRunRow[]> {
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT * FROM team51_runs WHERE project_slug = ? ORDER BY started_at DESC LIMIT ?`,
    )
    .all(projectSlug, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToTeam51Run).map(toPublicRow);
}

// --- Start (Terminal-launch flow) -----------------------------------------

export interface StartTeam51RunInput {
  project_slug: string;
  command: Team51CommandSlug;
  command_group: Team51CommandGroup;
  /**
   * Positional args first, then `--option=value` pairs. These get
   * quoted for the shell script. Do NOT include `--no-interaction` —
   * the whole point of this design is to let the CLI's interactive
   * prompts (confirmation, biometric handoff to `op`) happen
   * naturally in the terminal window.
   */
  args: string[];
}

export type StartTeam51RunResult =
  | { ok: true; run_id: string }
  | { ok: false; reason: "spawn-failed"; message: string };

/**
 * Kick off a team51 CLI run via Terminal.app.
 *
 * 1. Insert a `team51_runs` row with a fresh one-time `postback_token`.
 * 2. Write `/tmp/smithers-team51-<run_id>.sh` — runs the CLI, tees the
 *    log, then curls the log + exit code back to
 *    /api/team51/complete/<run_id>?token=<postback_token>.
 * 3. `osascript` tells Terminal.app to open that script. First run
 *    triggers a one-time macOS Automation permission prompt.
 * 4. Return `run_id` so the caller can navigate to the detail page.
 *
 * The postback endpoint (POST /api/team51/complete/[runId]) parses
 * the log for structured results (new site URL, etc.) and stamps
 * the row `completed` / `failed`. Detail page polls the DB while
 * status is queued/running.
 */
export async function startTeam51Run(
  input: StartTeam51RunInput,
): Promise<StartTeam51RunResult> {
  const runId = randomTeam51Id();
  const postbackToken = randomBytes(24).toString("hex");
  const cfg = await loadConfig();
  const scriptDir = join(cfg.paths.data, "team51-scripts");
  const logDir = join(cfg.paths.data, "team51-logs");
  await mkdir(scriptDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
  const scriptPath = join(scriptDir, `${runId}.sh`);
  const logPath = join(logDir, `${runId}.log`);

  const db = await getDb();
  db.prepare(
    `INSERT INTO team51_runs
       (id, project_slug, command, command_group, args_json,
        status, log_path, postback_token)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(
    runId,
    input.project_slug,
    input.command,
    input.command_group,
    JSON.stringify(input.args),
    logPath,
    postbackToken,
  );

  const scriptBody = buildRunScript({
    runId,
    postbackToken,
    logPath,
    command: input.command,
    args: input.args,
  });

  try {
    await writeFile(scriptPath, scriptBody, { encoding: "utf8" });
    await chmod(scriptPath, 0o755);
    await launchInTerminal(scriptPath);
    // Mark running only after the AppleScript spawn returns. The
    // postback will bump us to completed/failed.
    db.prepare(
      `UPDATE team51_runs SET status = 'running' WHERE id = ?`,
    ).run(runId);
    return { ok: true, run_id: runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE team51_runs
         SET status = 'failed',
             failure_kind = 'launch-failed',
             error_message = ?,
             completed_at = datetime('now')
         WHERE id = ?`,
    ).run(message.slice(0, 500), runId);
    return { ok: false, reason: "spawn-failed", message };
  }
}

// --- Script + AppleScript --------------------------------------------------

function buildRunScript(args: {
  runId: string;
  postbackToken: string;
  logPath: string;
  command: Team51CommandSlug;
  args: string[];
}): string {
  const { runId, postbackToken, logPath, command } = args;

  // Every value gets single-quoted so shell metacharacters in URLs /
  // names don't misinterpret. `team51` binary path is intentionally
  // NOT hardcoded — user's PATH resolves it (usually
  // /usr/local/bin/team51).
  const cmdLine = ["team51", shellQuote(command), ...args.args.map(shellQuote)].join(" ");

  // Postback URL: token in query string so intermediaries in the
  // localhost stack don't strip it. Also localhost-only.
  const postbackUrl = `http://localhost:3000/api/team51/complete/${runId}?token=${postbackToken}`;

  // Keep window open at the end so the user can read the outcome;
  // otherwise macOS Terminal closes on script exit per its shell-exit
  // preference.
  return `#!/bin/bash
set -o pipefail

RUN_ID='${runId}'
LOG='${logPath.replace(/'/g, `'\\''`)}'
POSTBACK_URL='${postbackUrl}'

echo "=== Smithers team51 run \${RUN_ID} ==="
echo "Command:"
echo "  ${cmdLine.replace(/'/g, `'\\''`)}"
echo "----------------------------------------"
echo ""

# Run the command, capturing both stdout + stderr to the log and to
# the terminal. PIPESTATUS captures the CLI's exit code (not tee's).
{ ${cmdLine} ; } 2>&1 | tee "\${LOG}"
EXIT_CODE=\${PIPESTATUS[0]}

echo ""
echo "----------------------------------------"
echo "Exit code: \${EXIT_CODE}"
echo "Reporting result back to Smithers..."

# Best-effort postback. If Smithers isn't running, the user can
# navigate to the run detail page later and it'll still show the log
# via the on-disk file.
curl -sS -X POST "\${POSTBACK_URL}" \\
  -H "Content-Type: text/plain" \\
  -H "X-Exit-Code: \${EXIT_CODE}" \\
  --data-binary @"\${LOG}" \\
  --max-time 10 \\
  -o /dev/null 2>&1 && echo "Reported. Safe to close." || echo "Postback failed (Smithers not running?). Log is at \${LOG}."

echo ""
echo "Press Return to close this window."
read
`;
}

async function launchInTerminal(scriptPath: string): Promise<void> {
  // `osascript` tells Terminal.app to open a new window running the
  // script. `activate` brings Terminal to the foreground so the user
  // sees prompts / biometric requests. First run triggers a macOS
  // Automation permission prompt (Smithers wants to control
  // Terminal.app); the OS remembers Allow.
  const script = `
    tell application "Terminal"
      activate
      do script "${scriptPath.replace(/"/g, `\\"`)}"
    end tell
  `;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/osascript", ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`osascript exited ${code}: ${stderr.trim()}`));
    });
  });
}

// --- Postback + result parsing --------------------------------------------

export interface CompleteInput {
  runId: string;
  token: string;
  logBody: string;
  exitCode: number;
}

/**
 * Callback from the on-disk script when the CLI finishes. Validates
 * the one-time token, persists the log, classifies success/failure,
 * parses structured results (new site URL), and offers a
 * frontmatter write-back path to the detail page.
 *
 * Never throws — all errors are recorded on the row so the detail
 * page can surface them. Returns whether the token was valid so the
 * endpoint can respond with 200 vs 403.
 */
export async function completeTeam51Run(
  input: CompleteInput,
): Promise<{ ok: boolean; reason?: string }> {
  const run = await getTeam51Run(input.runId);
  if (!run) return { ok: false, reason: "not-found" };
  if (!run.postback_token) return { ok: false, reason: "token-missing" };

  // Constant-time compare so a length-mismatch or content-mismatch
  // both take the same time.
  const expected = Buffer.from(run.postback_token);
  const provided = Buffer.from(input.token);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return { ok: false, reason: "bad-token" };
  }

  // Persist the log to disk (script already streamed it there via
  // tee; we overwrite with what the postback carried for
  // consistency, and in case the tee was interrupted).
  if (run.log_path) {
    try {
      await writeFile(run.log_path, input.logBody, { encoding: "utf8" });
    } catch {
      /* non-fatal — the DB row still records status */
    }
  }

  const captured = parseTeam51ResultUrl(run.command, input.logBody);
  const status: Team51RunStatus = input.exitCode === 0 ? "completed" : "failed";
  const failureKind =
    input.exitCode === 0
      ? null
      : classifyFailureFromLog(input.logBody, input.exitCode);
  const errorMessage =
    input.exitCode === 0 ? null : lastMeaningfulLine(input.logBody);

  const db = await getDb();
  db.prepare(
    `UPDATE team51_runs
       SET status = ?,
           completed_at = datetime('now'),
           exit_code = ?,
           failure_kind = ?,
           error_message = ?,
           captured_url = ?,
           postback_token = NULL
     WHERE id = ?`,
  ).run(
    status,
    input.exitCode,
    failureKind,
    errorMessage,
    captured,
    input.runId,
  );

  // Clean up the on-disk script — it's single-use. Log stays.
  const cfg = await loadConfig();
  const scriptPath = join(cfg.paths.data, "team51-scripts", `${input.runId}.sh`);
  await unlink(scriptPath).catch(() => undefined);

  return { ok: true };
}

/**
 * Regex per command variant against the CLI's own success output.
 * Pulled from team51-cli command sources — most create-site
 * commands print a final line like:
 *   "Successfully created site at https://foo.wordpress.com"
 * or similar. Returns the first matching URL or null.
 */
export function parseTeam51ResultUrl(
  command: Team51CommandSlug,
  log: string,
): string | null {
  // Loose but ordered patterns — first match wins per command.
  const patterns: Record<Team51CommandSlug, RegExp[]> = {
    "wpcom:create-site": [
      /Successfully created (?:site )?at\s+(https:\/\/[^\s]+)/i,
      /new site (?:at |URL: ?)(https:\/\/[^\s]+)/i,
      // Fallback: any WPCOM-shaped URL that appears late in the log.
      /(https:\/\/[a-z0-9-]+\.wordpress\.com\/?)/i,
    ],
    "pressable:create-site": [
      /Successfully created (?:site )?at\s+(https:\/\/[^\s]+)/i,
      /new site (?:at |URL: ?)(https:\/\/[^\s]+)/i,
      // Fallback: mystagingwebsite.com or similar Pressable domain.
      /(https:\/\/[a-z0-9-]+\.(?:mystagingwebsite\.com|pressable\.com)\/?)/i,
    ],
    "pressable:clone-site": [
      /Successfully cloned (?:site )?to\s+(https:\/\/[^\s]+)/i,
      /clone (?:URL|available at):?\s*(https:\/\/[^\s]+)/i,
      /(https:\/\/[a-z0-9-]+\.(?:mystagingwebsite\.com|pressable\.com)\/?)/i,
    ],
    // WP-CLI runs don't create resources.
    "wpcom:run-site-wp-cli-command": [],
    "pressable:run-site-wp-cli-command": [],
  };
  for (const re of patterns[command] ?? []) {
    const m = re.exec(log);
    if (m) return m[1] ?? m[0];
  }
  return null;
}

function classifyFailureFromLog(log: string, exitCode: number): string {
  // Just enough classification for the detail page to color-code the
  // outcome. The bulk of the diagnostic value lives in the log
  // itself, which we always show.
  if (exitCode === 2 && /aborted by user|Command aborted/i.test(log)) {
    return "user-cancelled";
  }
  if (/site_already_exists|already exists|already registered/i.test(log)) {
    return "duplicate-resource";
  }
  if (/401|403|unauthorized|invalid_token|authentication failed/i.test(log)) {
    return "auth-failed";
  }
  return "generic-failure";
}

function lastMeaningfulLine(log: string): string {
  return (
    log
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("==="))
      .slice(-1)[0] ?? ""
  ).slice(0, 500);
}

// --- Log tail --------------------------------------------------------------

export async function readTeam51RunLog(runId: string): Promise<string | null> {
  const run = await getTeam51Run(runId);
  if (!run?.log_path) return null;
  try {
    const raw = await readFile(run.log_path, "utf-8");
    if (raw.length > 200_000) return raw.slice(-200_000);
    return raw;
  } catch {
    return null;
  }
}

// --- Frontmatter write-back ------------------------------------------------

/**
 * Write the captured URL into the project's frontmatter. Which
 * field depends on the command:
 *   - wpcom:create-site → production_url (fresh sites go live)
 *   - pressable:create-site → staging_url (partners typically get
 *     Pressable as staging before WPCOM production)
 *   - pressable:clone-site → staging_url (the clone IS the staging)
 * Returns whether anything was written.
 */
export async function writeBackCapturedUrl(
  runId: string,
): Promise<{ written: boolean; field?: string; url?: string; message?: string }> {
  const run = await getTeam51Run(runId);
  if (!run) return { written: false, message: "run not found" };
  if (!run.captured_url) return { written: false, message: "no URL captured" };

  const field = frontmatterFieldForCommand(run.command);
  if (!field) return { written: false, message: "command has no writeback target" };

  const vault = await getVault();
  const patch: Record<string, string> = { [field]: run.captured_url };
  try {
    const result = await vault.updateProjectFrontmatter(run.project_slug, patch);
    return {
      written: result.changed,
      field,
      url: run.captured_url,
      message: result.changed ? "written" : "already set to this value",
    };
  } catch (err) {
    return {
      written: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function frontmatterFieldForCommand(command: Team51CommandSlug): string | null {
  switch (command) {
    case "wpcom:create-site":
      return "production_url";
    case "pressable:create-site":
    case "pressable:clone-site":
      return "staging_url";
    default:
      return null;
  }
}

// --- Internals -------------------------------------------------------------

function randomTeam51Id(): string {
  // Prefix distinguishes from qa_ ids in ~/.smithers.
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  const now = Date.now().toString(36);
  const rand = Array.from({ length: 20 - 3 - now.length }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length)),
  ).join("");
  return `t51${now}${rand}`;
}

function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9._@:/=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// --- Legacy exports (needed while dialogs unchanged) -----------------------
//
// These type shells kept for back-compat with server actions that
// still reference them. Actual runtime behavior is now delegated to
// startTeam51Run above.

export type ExternalTool = "op" | "gh" | "ssh";
