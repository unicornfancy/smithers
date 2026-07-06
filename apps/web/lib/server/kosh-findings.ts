import "server-only";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Resolve a CLI's absolute path by probing known install locations.
 *
 * The Next.js server-action worker can run with a reduced PATH —
 * Homebrew's `/usr/local/bin` (Intel) and `/opt/homebrew/bin`
 * (Apple Silicon) aren't always inherited when the dev server was
 * launched from a GUI terminal. That means both spawn("gh") AND
 * spawn("/usr/bin/which", ["gh"]) come up empty: which itself
 * searches the spawn process's PATH, which is exactly what's
 * stripped.
 *
 * So we don't ask the system at all — we check the two Homebrew
 * locations plus /usr/bin/ directly. If a user has gh installed
 * somewhere exotic they can add a SMITHERS_<NAME>_PATH env var
 * override (e.g. SMITHERS_GH_PATH=/foo/bar/gh).
 */
function resolveBinary(name: string): string | null {
  const envOverride = process.env[`SMITHERS_${name.toUpperCase()}_PATH`];
  if (envOverride && existsSync(envOverride)) return envOverride;
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

import { getQaRun, readQaRunReport, type QaTestType } from "./kosh";
import { getVault } from "./vault";

export type FindingSeverity = "critical" | "high" | "medium" | "low";

export interface KoshFinding {
  /** Stable id derived from (severity, category, issue) so UI selection survives a refresh. */
  id: string;
  severity: FindingSeverity;
  category: string;
  issue: string;
  impact?: string;
  device?: string;
  pages?: string[];
  metric?: string;
}

/**
 * Walk a kosh report JSON and emit one flat finding per row, severities
 * preserved in the id and as a field. Severity order: critical, high,
 * medium, low (matches kosh's own ranking).
 */
export function parseKoshFindings(json: unknown): KoshFinding[] {
  if (!json || typeof json !== "object") return [];
  const issues = (json as Record<string, unknown>).issues;
  if (!issues || typeof issues !== "object") return [];
  const bag = issues as Record<string, unknown>;
  const out: KoshFinding[] = [];
  const severities: FindingSeverity[] = ["critical", "high", "medium", "low"];
  for (const sev of severities) {
    const arr = bag[sev];
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      const finding = coerceFinding(raw, sev);
      if (finding) out.push(finding);
    }
  }
  return out;
}

function coerceFinding(raw: unknown, severity: FindingSeverity): KoshFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const category = typeof r.category === "string" ? r.category : "General";
  const issue = typeof r.issue === "string" ? r.issue : null;
  if (!issue) return null;
  const id = stableId(`${severity}:${category}:${issue}`);
  return {
    id,
    severity,
    category,
    issue,
    impact: typeof r.impact === "string" ? r.impact : undefined,
    device: typeof r.device === "string" ? r.device : undefined,
    pages: Array.isArray(r.pages)
      ? r.pages.filter((p): p is string => typeof p === "string")
      : undefined,
    metric: typeof r.metric === "string" ? r.metric : undefined,
  };
}

function stableId(seed: string): string {
  // Cheap djb2 hash — collision-free enough for ~50 findings per report.
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  }
  return `f${h.toString(36)}`;
}

const TEST_LABEL: Record<QaTestType, string> = {
  "functional-design": "Functional & design",
  performance: "Performance",
  a11y: "Accessibility",
  aeo: "AEO",
};

export interface BuildIssueInput {
  runId: string;
  findingIds: string[];
}

export interface IssueDraft {
  title: string;
  body: string;
  github_repo: string | null;
  selected: KoshFinding[];
}

/**
 * Build the title + body for a "create issue from kosh findings" submission.
 * The body is a markdown checklist — works for both GitHub issues and
 * paste-into-Linear use cases.
 */
export async function buildKoshIssueDraft(
  input: BuildIssueInput,
): Promise<IssueDraft | null> {
  const result = await readQaRunReport(input.runId);
  if (!result) return null;
  const { run, json } = result;
  const findings = parseKoshFindings(json);
  const selected = findings.filter((f) => input.findingIds.includes(f.id));
  if (selected.length === 0) return null;

  const vault = await getVault();
  const project = await vault.readProject(run.project_slug).catch(() => null);
  const siteName =
    (json && typeof json === "object" && typeof (json as Record<string, unknown>).websiteName === "string"
      ? ((json as Record<string, unknown>).websiteName as string)
      : null) ??
    project?.name ??
    run.target_url;

  const title = `Kosh: ${TEST_LABEL[run.test_type]} — ${siteName}`;
  const body = renderIssueBody({ run, selected, siteName });
  return {
    title,
    body,
    github_repo: project?.github_repo ?? null,
    selected,
  };
}

function renderIssueBody(args: {
  run: Awaited<ReturnType<typeof readQaRunReport>> extends infer R
    ? R extends { run: infer T }
      ? T
      : never
    : never;
  selected: KoshFinding[];
  siteName: string;
}): string {
  const { run, selected, siteName } = args;
  const lines: string[] = [];
  lines.push(`From a Kosh ${TEST_LABEL[run.test_type]} run against ${run.target_url} (env: ${run.env}).`);
  lines.push("");
  lines.push(`**Site:** ${siteName}`);
  lines.push(`**Run started:** ${run.started_at}`);
  if (run.report_md_relpath) {
    lines.push(`**Source report:** \`${run.report_md_relpath}\``);
  }
  lines.push("");
  lines.push("## Items to address");
  lines.push("");
  for (const f of selected) {
    lines.push(`- [ ] **[${f.severity.toUpperCase()} · ${f.category}]** ${f.issue}`);
    if (f.impact) lines.push(`  - _Impact_: ${f.impact}`);
    if (f.metric) lines.push(`  - _Metric_: ${f.metric}`);
    if (f.device) lines.push(`  - _Device_: ${f.device}`);
    if (f.pages && f.pages.length > 0) {
      lines.push(`  - _Pages_: ${f.pages.map((p) => p).join(" · ")}`);
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("_Created from Smithers · Kosh QA workflow._");
  return lines.join("\n");
}

/**
 * Shell out to `gh issue create` with the body on stdin. Returns the
 * URL of the created issue on success.
 *
 * Repo must be owner/repo or a full GitHub URL — gh accepts both via
 * `-R`. Auth uses whatever `gh auth login` is configured with (in this
 * project, unicornfancy via SSH).
 */
export async function createGhIssue(args: {
  repo: string;
  title: string;
  body: string;
}): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const ghBin = resolveBinary("gh");
  if (!ghBin) {
    return {
      ok: false,
      message:
        "`gh` CLI not found at /opt/homebrew/bin, /usr/local/bin, or /usr/bin. Install via `brew install gh` + `gh auth login`, or set SMITHERS_GH_PATH if installed elsewhere.",
    };
  }
  return new Promise((resolve) => {
    const child = spawn(
      ghBin,
      [
        "issue",
        "create",
        "-R",
        args.repo,
        "--title",
        args.title,
        "--body-file",
        "-",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("error", (err) => {
      resolve({ ok: false, message: err.message });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          message: (stderr || stdout || `gh exited with code ${code}`)
            .trim()
            .slice(0, 500),
        });
        return;
      }
      const url = (stdout || stderr)
        .trim()
        .split("\n")
        .find((l) => l.startsWith("https://"));
      if (!url) {
        resolve({
          ok: false,
          message: "gh succeeded but no URL in output — check manually",
        });
        return;
      }
      resolve({ ok: true, url });
    });
    child.stdin.write(args.body);
    child.stdin.end();
  });
}

export async function getKoshFindingsForRun(
  runId: string,
): Promise<{ findings: KoshFinding[]; run_type: QaTestType } | null> {
  const run = await getQaRun(runId);
  if (!run) return null;
  const result = await readQaRunReport(runId);
  if (!result) return null;
  return {
    findings: parseKoshFindings(result.json),
    run_type: run.test_type,
  };
}
