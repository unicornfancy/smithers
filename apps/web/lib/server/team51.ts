import "server-only";

import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { join } from "node:path";

import { loadConfig } from "./config";
import { getDb } from "./db";

const execFileAsync = promisify(execFile);

// --- Types -----------------------------------------------------------------

/** Symfony command slug — e.g. `wpcom:create-site`. */
export type Team51CommandSlug =
  | "wpcom:create-site"
  | "pressable:create-site"
  | "pressable:clone-site"
  | "wpcom:run-site-wp-cli-command"
  | "pressable:run-site-wp-cli-command";

export type Team51CommandGroup = "wpcom" | "pressable" | "github" | "deployhq";

export type Team51RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Structured failure classification. `external-auth-failed:<tool>`
 * for auth errors from tools the CLI shells out to (e.g. `op`,
 * `gh`); other classes surface Symfony's own error patterns.
 */
export type Team51FailureKind =
  | "user-cancelled"
  | "duplicate-resource"
  | "auth-failed"
  | "missing-arg"
  | "timeout"
  | "unknown-command"
  | "external-auth-failed"
  | "generic-failure";

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
  /** Structured failure_kind: prefix like `external-auth-failed:op`. */
  failure_kind: string | null;
  error_message: string | null;
  /** Post-run structured result (site URL, ID, credentials, etc.). JSON string. */
  result_json: string | null;
}

// --- Binary resolution -----------------------------------------------------

/**
 * Resolve the `team51` CLI binary. Same probe pattern as `gh` in
 * kosh-findings.ts — check known Homebrew locations plus /usr/bin
 * directly, since Next.js server-action workers can run with a
 * stripped PATH that omits `/usr/local/bin`. The user's local
 * install is normally at `/usr/local/bin/team51` (a symlink to the
 * PHP entrypoint in `~/team51-cli`).
 *
 * Escape-hatch env override: `SMITHERS_TEAM51_PATH`.
 */
export function resolveTeam51Binary(): string | null {
  const envOverride = process.env["SMITHERS_TEAM51_PATH"];
  if (envOverride && existsSync(envOverride)) return envOverride;
  const candidates = [
    "/opt/homebrew/bin/team51",
    "/usr/local/bin/team51",
    "/usr/bin/team51",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export interface Team51Detection {
  binary: string | null;
  ready: boolean;
  reason?: string;
}

export async function detectTeam51(): Promise<Team51Detection> {
  const binary = resolveTeam51Binary();
  if (!binary) {
    return {
      binary: null,
      ready: false,
      reason:
        "team51 CLI not found. Install per https://github.com/a8cteam51/team51-cli, or set SMITHERS_TEAM51_PATH.",
    };
  }
  return { binary, ready: true };
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
): Promise<Team51RunRow[]> {
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT * FROM team51_runs WHERE project_slug = ? ORDER BY started_at DESC LIMIT ?`,
    )
    .all(projectSlug, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToTeam51Run);
}

// --- Spawn + classify ------------------------------------------------------

export interface StartTeam51RunInput {
  project_slug: string;
  command: Team51CommandSlug;
  command_group: Team51CommandGroup;
  /**
   * Full argv AFTER the command slug — positional args first, then
   * `--option=value` pairs. Callers must NOT include `--no-interaction` /
   * `-n`; runTeam51 appends that automatically.
   *
   * Sensitive values (passwords, tokens) MUST NOT appear here — put
   * them in `env` instead. args_json is persisted in the DB and
   * shown in the detail page; env is not.
   */
  args: string[];
  /**
   * Extra env vars to hand to the subprocess. Merged over
   * process.env at spawn time. Use for anything sensitive.
   */
  env?: Record<string, string>;
  /**
   * Hard timeout in ms after which we SIGTERM the child + mark the
   * run as `failed` with `failure_kind = "timeout"`. Defaults to
   * 10 minutes — long enough for site-creation flows without
   * leaving true hangs open forever.
   */
  timeout_ms?: number;
  /**
   * External tools this command depends on. Probed BEFORE the
   * subprocess spawns; if any fail, the run is recorded as
   * `external-auth-failed:<tool>` without touching the CLI at all.
   * Empty = skip pre-flight.
   */
  required_tools?: ExternalTool[];
}

export interface StartTeam51RunResult {
  ok: true;
  run_id: string;
}

export interface StartTeam51RunError {
  ok: false;
  reason: "not-configured" | "spawn-failed";
  message: string;
}

/**
 * Kick off a team51-cli run. Persists a `team51_runs` row, spawns
 * the child, streams stdout/stderr to disk + the row's classifier,
 * and eventually stamps the row `completed` / `failed` / `cancelled`.
 * Returns the run id immediately so callers can navigate to a live
 * detail page.
 *
 * `--no-interaction` is appended so the CLI never blocks on a
 * prompt — Smithers renders the same prompts as web forms and
 * collects answers before this is called.
 */
export async function startTeam51Run(
  input: StartTeam51RunInput,
): Promise<StartTeam51RunResult | StartTeam51RunError> {
  const detect = await detectTeam51();
  if (!detect.ready || !detect.binary) {
    return { ok: false, reason: "not-configured", message: detect.reason ?? "" };
  }

  const runId = randomTeam51Id();
  const cfg = await loadConfig();
  const logDir = join(cfg.paths.data, "team51-logs");
  await mkdir(logDir, { recursive: true });
  const logPath = join(logDir, `${runId}.log`);

  const db = await getDb();
  db.prepare(
    `INSERT INTO team51_runs (id, project_slug, command, command_group, args_json, status, log_path)
     VALUES (?, ?, ?, ?, ?, 'running', ?)`,
  ).run(
    runId,
    input.project_slug,
    input.command,
    input.command_group,
    JSON.stringify(input.args),
    logPath,
  );

  // Pre-flight external tools BEFORE spawning. Catches the common
  // "op session expired" case without wasting a subprocess. If any
  // probe fails, we stamp `external-auth-failed:<tool>` and return
  // the run_id — the detail page renders the right recovery card.
  if (input.required_tools && input.required_tools.length > 0) {
    const probes = await probeExternalTools(input.required_tools);
    const firstFail = probes.find((p) => !p.ok);
    if (firstFail) {
      await appendLog(
        logPath,
        `[preflight] ${firstFail.tool}: ${firstFail.message}\n` +
          (firstFail.remedy ? `[preflight remedy] ${firstFail.remedy}\n` : ""),
      );
      await recordTeam51Failure(
        runId,
        `external-auth-failed:${firstFail.tool}`,
        firstFail.remedy
          ? `${firstFail.message} ${firstFail.remedy}`
          : firstFail.message,
        null,
      );
      return { ok: true, run_id: runId };
    }
  }

  // Fire and forget — the spawn callback owns the row's lifecycle
  // and log tail from here. Errors caught + recorded to the row.
  void runTeam51Child({
    runId,
    binary: detect.binary,
    input,
    logPath,
  }).catch(async (err) => {
    await appendLog(
      logPath,
      `\n[team51-runner-crashed] ${err instanceof Error ? err.message : String(err)}\n`,
    );
    await recordTeam51Failure(runId, "generic-failure", "Runner crashed", null);
  });

  return { ok: true, run_id: runId };
}

async function runTeam51Child(args: {
  runId: string;
  binary: string;
  input: StartTeam51RunInput;
  logPath: string;
}): Promise<void> {
  const { runId, binary, input, logPath } = args;

  await appendLog(
    logPath,
    `[${new Date().toISOString()}] ${binary} ${input.command} ${input.args.join(" ")} --no-interaction\n`,
  );

  const argv = [input.command, ...input.args, "--no-interaction"];
  const child = spawn(binary, argv, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(input.env ?? {}) },
  });

  const db = await getDb();
  db.prepare(`UPDATE team51_runs SET pid = ? WHERE id = ?`).run(
    child.pid ?? null,
    runId,
  );

  let stderrBuf = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    void appendLog(logPath, chunk.toString());
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrBuf += text;
    // Cap in-memory buffer at 40KB — we only need the tail for
    // classification, and the full stderr is on disk anyway.
    if (stderrBuf.length > 40_000) {
      stderrBuf = stderrBuf.slice(-40_000);
    }
    void appendLog(logPath, text);
  });

  // Hard timeout — Symfony commands can take minutes but shouldn't
  // truly hang. On timeout we SIGTERM and record `timeout`.
  const timeoutMs = input.timeout_ms ?? 10 * 60 * 1000;
  const timer = setTimeout(() => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already dead */
    }
    void appendLog(logPath, `\n[team51 timeout] killed after ${timeoutMs}ms\n`);
  }, timeoutMs);

  child.on("error", (err) => {
    void appendLog(logPath, `\n[team51 spawn error] ${err.message}\n`);
  });

  await new Promise<void>((resolve) => {
    child.on("close", async (code, signal) => {
      clearTimeout(timer);
      await appendLog(
        logPath,
        `\n[${new Date().toISOString()}] child exited code=${code} signal=${signal ?? "none"}\n`,
      );
      try {
        // Cancel wins over any classification: user might have hit
        // the Cancel button while the child was mid-flow.
        const cur = await getTeam51Run(runId);
        if (cur?.status === "cancelled") {
          resolve();
          return;
        }

        // Timeout-kill fingerprint.
        if (signal === "SIGTERM") {
          await recordTeam51Failure(runId, "timeout", "Command timed out", code);
          resolve();
          return;
        }

        if (code === 0) {
          const db2 = await getDb();
          db2.prepare(
            `UPDATE team51_runs SET status = 'completed', completed_at = datetime('now'), exit_code = 0 WHERE id = ?`,
          ).run(runId);
          resolve();
          return;
        }

        // Non-zero. Classify from stderr tail.
        const [kind, message] = classifyTeam51Failure(stderrBuf, code ?? -1);
        await recordTeam51Failure(runId, kind, message, code);
      } catch (err) {
        await appendLog(
          logPath,
          `\n[team51 close handler crashed] ${err instanceof Error ? err.message : String(err)}\n`,
        );
        await recordTeam51Failure(
          runId,
          "generic-failure",
          err instanceof Error ? err.message : "Close handler crashed",
          code,
        );
      } finally {
        resolve();
      }
    });
  });
}

async function recordTeam51Failure(
  runId: string,
  kind: string,
  message: string,
  exitCode: number | null,
): Promise<void> {
  try {
    const db = await getDb();
    db.prepare(
      `UPDATE team51_runs
         SET status = 'failed',
             completed_at = datetime('now'),
             exit_code = ?,
             failure_kind = ?,
             error_message = ?
         WHERE id = ?`,
    ).run(exitCode, kind, message.slice(0, 2000), runId);
  } catch {
    // Nothing to do — a DB error here would already show in the log
    // and re-trying wouldn't help; leaving the row `running` is
    // still better than crashing the caller.
  }
}

// --- Classifier ------------------------------------------------------------

/**
 * Map an exit code + stderr tail to a structured
 * (failure_kind, human message) pair. Order matters: more-specific
 * patterns are checked first so a duplicate-resource error doesn't
 * get swallowed by the generic "authentication" catch.
 *
 * Patterns are pulled from the CLI's own error messages (grep'd
 * from ~/team51-cli/commands/*.php) and from external tools the
 * CLI shells out to (op, gh). Add new patterns here as we see them
 * in the wild — the classifier is the single seam.
 */
export function classifyTeam51Failure(
  stderr: string,
  exitCode: number,
): [Team51FailureKind, string] {
  const tail = stderr.slice(-8_000);

  // Symfony `Not enough arguments` — Smithers should have passed
  // this. Surfaces our own gaps so we can add form fields.
  if (/Not enough arguments|not enough arguments/i.test(tail)) {
    const m = /argument "([^"]+)"/i.exec(tail);
    return [
      "missing-arg",
      m
        ? `Smithers didn't pass the required "${m[1]}" argument.`
        : "Smithers didn't pass a required argument.",
    ];
  }

  // Symfony `Command "..." is not defined`.
  if (/Command "([^"]+)" is not defined/i.test(tail)) {
    const m = /Command "([^"]+)" is not defined/i.exec(tail);
    return ["unknown-command", `team51 doesn't know the command "${m?.[1] ?? "?"}"`];
  }

  // User aborted at the confirmation prompt — exit code 2 is the
  // team51 CLI's own convention.
  if (exitCode === 2 && /aborted by user|Command aborted/i.test(tail)) {
    return ["user-cancelled", "Command aborted."];
  }

  // Duplicate resource — CLI-specific error codes.
  if (
    /site_already_exists|already exists|already registered|repository already exists/i.test(
      tail,
    )
  ) {
    return [
      "duplicate-resource",
      "A resource with this name already exists — try a different name.",
    ];
  }

  // External tool auth failures — `op` (1Password), `gh` (GitHub CLI).
  if (
    /\[ERROR\] .*(?:signin|1Password)|(?:op |op:).*not currently signed in|op vault list.*(?:error|not signed)/i.test(
      tail,
    )
  ) {
    return [
      "external-auth-failed",
      "The 1Password CLI (`op`) isn't authenticated. Fix: run `op signin` in the terminal that hosts pnpm dev, or enable 1Password 8 desktop CLI integration.",
    ];
  }
  if (/gh: not authenticated|gh auth login|GitHub CLI is not authenticated/i.test(tail)) {
    return [
      "external-auth-failed",
      "The GitHub CLI (`gh`) isn't authenticated. Fix: run `gh auth login` in your terminal.",
    ];
  }

  // WPCOM / Automattic API auth.
  if (
    /(?:401|403|unauthorized|invalid_token|authentication failed|invalid credentials)/i.test(
      tail,
    )
  ) {
    return [
      "auth-failed",
      "team51 CLI hit an authentication error. Check `~/.team51/config.php` or your API tokens.",
    ];
  }

  // Fallback: pull the last non-empty stderr line.
  const lastMeaningful = tail
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("["))
    .slice(-1)[0];
  return [
    "generic-failure",
    lastMeaningful || `Command exited with code ${exitCode}.`,
  ];
}

// --- Cancel ----------------------------------------------------------------

export async function cancelTeam51Run(runId: string): Promise<boolean> {
  const run = await getTeam51Run(runId);
  if (!run) return false;
  if (run.status !== "running" && run.status !== "queued") return false;
  if (run.pid) {
    try {
      process.kill(run.pid, "SIGTERM");
    } catch {
      /* already dead */
    }
  }
  const db = await getDb();
  db.prepare(
    `UPDATE team51_runs SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?`,
  ).run(runId);
  return true;
}

// --- Log tail --------------------------------------------------------------

/**
 * Read the run's on-disk log for the detail page. Cap at the last
 * 200KB so a runaway CLI doesn't blow up the page render.
 */
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

// --- External-tool pre-flight ---------------------------------------------

/**
 * External tools the team51 CLI shells out to. Order roughly
 * matches how often a command uses them — 1Password is the
 * highest-risk failure surface (session expiry).
 */
export type ExternalTool = "op" | "gh" | "ssh";

export interface ExternalToolProbe {
  tool: ExternalTool;
  /** True when the probe found the tool AND it's authenticated. */
  ok: boolean;
  /** Short diagnostic — shown in the failure card and Test-tools output. */
  message: string;
  /** For fixups: the exact command the user would run to fix it. */
  remedy?: string;
  /**
   * Raw last line of stderr (truncated) when the probe failed —
   * lets the Test tools card show what the CLI actually complained
   * about instead of a paraphrase. Missing on success.
   */
  detail?: string;
  /** Resolved version string (e.g. "2.30.0") when it can be read. */
  version?: string;
}

/**
 * Run a cheap probe per external tool with a short timeout.
 * Parallelizable, so the Test-tools button can render results as
 * they arrive. Not called before every run — callers opt into
 * pre-flight per command.
 */
export async function probeExternalTools(
  tools: ExternalTool[],
): Promise<ExternalToolProbe[]> {
  return Promise.all(tools.map((t) => probeExternalTool(t)));
}

async function probeExternalTool(tool: ExternalTool): Promise<ExternalToolProbe> {
  switch (tool) {
    case "op":
      return probeOp();
    case "gh":
      return probeGh();
    case "ssh":
      return probeSsh();
  }
}

async function probeOp(): Promise<ExternalToolProbe> {
  const bin = probePath("op");
  if (!bin) {
    return {
      tool: "op",
      ok: false,
      message: "1Password CLI (`op`) not installed.",
      remedy: "brew install 1password-cli",
    };
  }

  // Version stamp helps users diagnose stale-CLI vs. auth-config issues.
  // Older `op` versions (<= 2.20-ish) had known desktop-integration
  // bugs with subprocess callers, so surface the version prominently.
  let version: string | undefined;
  try {
    const { stdout } = await execFileAsync(bin, ["--version"], {
      timeout: 3_000,
    });
    version = stdout.trim();
  } catch {
    /* ignore — version is informational */
  }

  try {
    // 15s to accommodate a biometric prompt if desktop integration
    // kicks one off. `op whoami` is the cheapest signed-in check.
    await execFileAsync(bin, ["whoami"], { timeout: 15_000 });
    return {
      tool: "op",
      ok: true,
      message: `Signed in via ${bin}.`,
      version,
    };
  } catch (err) {
    const stderr = extractStderr(err);
    const detail = firstMeaningfulLine(stderr);
    // Classify by the exact error `op` reports so the remedy is
    // specific instead of a hand-wavy "check auth".
    const remedy = pickOpRemedy(stderr, version);
    return {
      tool: "op",
      ok: false,
      message: opFailureSummary(stderr),
      remedy,
      detail,
      version,
    };
  }
}

/**
 * `op` prints structured error lines like:
 *   [ERROR] 2026/... account is not signed in
 *   [ERROR] 2026/... could not connect to 1Password
 *   [ERROR] 2026/... this account isn't currently authorized
 * The classifier picks a specific summary + remedy. Falls back to
 * the raw first line when no pattern matches so the user always
 * sees `op`'s own words.
 */
function opFailureSummary(stderr: string): string {
  if (/not signed in/i.test(stderr)) {
    return "1Password says: account is not signed in.";
  }
  if (/could not connect to 1Password|connecting to desktop app/i.test(stderr)) {
    return "1Password says: can't connect to the desktop app.";
  }
  if (/not (?:currently )?authorized/i.test(stderr)) {
    return "1Password says: this caller isn't authorized.";
  }
  const first = firstMeaningfulLine(stderr);
  return first ? `\`op whoami\` failed: ${first}` : "`op whoami` failed.";
}

function pickOpRemedy(stderr: string, version: string | undefined): string {
  const versionHint = looksOldOpVersion(version)
    ? ` Also: your op CLI is ${version} — older versions had subprocess-handoff bugs. \`brew upgrade 1password-cli\` if you can.`
    : "";
  if (/not signed in/i.test(stderr)) {
    return (
      "Run `op signin` in the SAME terminal that started pnpm dev, then restart the dev server so it inherits the fresh session. If you use 1Password 8 desktop integration, make sure the terminal is listed under Settings → Developer → Manage authorized apps." +
      versionHint
    );
  }
  if (/could not connect to 1Password|connecting to desktop app/i.test(stderr)) {
    return (
      "The 1Password 8 desktop app isn't running (or the CLI toggle is off). Open it, then check Settings → Developer → Integrate with 1Password CLI." +
      versionHint
    );
  }
  if (/not (?:currently )?authorized/i.test(stderr)) {
    return (
      "1Password 8 → Settings → Developer → Manage authorized apps. Add / re-authorize the terminal you use for pnpm dev." +
      versionHint
    );
  }
  return (
    "Run `op signin` in the pnpm-dev terminal, or turn on 1Password 8 → Settings → Developer → Integrate with 1Password CLI." +
    versionHint
  );
}

/**
 * `op` versions before ~2.20 had subprocess-handoff bugs with the
 * 1Password 8 desktop integration. Coarse semver check — if we
 * can't parse the version, don't nag.
 */
function looksOldOpVersion(version: string | undefined): boolean {
  if (!version) return false;
  const m = /^(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major < 2) return true;
  if (major === 2 && minor < 20) return true;
  return false;
}

function extractStderr(err: unknown): string {
  if (err && typeof err === "object") {
    const obj = err as { stderr?: unknown; message?: unknown };
    if (typeof obj.stderr === "string") return obj.stderr;
    if (typeof obj.message === "string") return obj.message;
  }
  return String(err);
}

function firstMeaningfulLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ""
  ).slice(0, 240);
}

async function probeGh(): Promise<ExternalToolProbe> {
  const bin = probePath("gh");
  if (!bin) {
    return {
      tool: "gh",
      ok: false,
      message: "GitHub CLI (`gh`) not installed.",
      remedy: "brew install gh",
    };
  }
  try {
    await execFileAsync(bin, ["auth", "status"], { timeout: 5_000 });
    return { tool: "gh", ok: true, message: `Authenticated via ${bin}.` };
  } catch {
    return {
      tool: "gh",
      ok: false,
      message: "`gh auth status` failed — not signed in.",
      remedy: "Run `gh auth login`.",
    };
  }
}

async function probeSsh(): Promise<ExternalToolProbe> {
  const bin = probePath("ssh");
  if (!bin) {
    return {
      tool: "ssh",
      ok: false,
      message: "`ssh` not found — unexpected for macOS.",
    };
  }
  try {
    // Exit code 1 = auth OK but no shell allowed (GitHub's response).
    // Exit code 255 = auth failed / can't reach.
    const res = await execFileAsync(bin, [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      "git@github.com",
    ]).catch((err: Error & { code?: number }) => err);
    const code = (res as { code?: number }).code;
    if (code === 1) {
      return { tool: "ssh", ok: true, message: "GitHub SSH auth OK." };
    }
    return {
      tool: "ssh",
      ok: false,
      message: `GitHub SSH probe returned code ${code}.`,
      remedy:
        "Add your SSH key to GitHub and start ssh-agent (`ssh-add ~/.ssh/id_ed25519`).",
    };
  } catch {
    return {
      tool: "ssh",
      ok: false,
      message: "GitHub SSH probe failed unexpectedly.",
    };
  }
}

function probePath(name: string): string | null {
  const candidates = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// --- Internals -------------------------------------------------------------

async function appendLog(logPath: string, text: string): Promise<void> {
  try {
    await appendFile(logPath, text);
  } catch {
    // Full-disk / log-gone case — status row is authoritative, so
    // dropping the log line is acceptable.
  }
}

function randomTeam51Id(): string {
  // Same shape as qa run ids: alphanumeric, 20 chars, sortable
  // enough for filesystem ordering. Prefix distinguishes from
  // qa_ ids so a grep in ~/.smithers/ tells them apart.
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  const now = Date.now().toString(36);
  const rand = Array.from({ length: 20 - 3 - now.length }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length)),
  ).join("");
  return `t51${now}${rand}`;
}
