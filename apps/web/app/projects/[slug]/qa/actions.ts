"use server";

import { revalidatePath } from "next/cache";

import {
  cancelQaRun,
  ingestQaRun,
  startQaRun,
  type QaEnv,
  type QaTestType,
} from "@/lib/server/kosh";
import {
  buildKoshIssueDraft,
  createGhIssue,
} from "@/lib/server/kosh-findings";

type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? {} : { data: T }))
  | { ok: false; reason: string; message?: string };

export async function startQaRunAction(input: {
  project_slug: string;
  test_type: QaTestType;
  target_url: string;
  env?: QaEnv;
}): Promise<ActionResult<{ run_id: string; queued_behind: number }>> {
  const res = await startQaRun(input);
  if (res.ok) {
    revalidatePath(`/projects/${input.project_slug}/qa`);
    return {
      ok: true,
      data: { run_id: res.run_id, queued_behind: res.queued_behind },
    };
  }
  return { ok: false, reason: res.reason, message: res.message };
}

/**
 * Queue every test type for the same URL in one shot. Returns the
 * three run ids in the order they'll execute.
 */
export async function queueAllQaRunsAction(input: {
  project_slug: string;
  target_url: string;
  env?: QaEnv;
}): Promise<ActionResult<{ run_ids: string[] }>> {
  const types: QaTestType[] = ["functional-design", "performance", "a11y", "aeo"];
  const ids: string[] = [];
  for (const t of types) {
    const res = await startQaRun({
      project_slug: input.project_slug,
      test_type: t,
      target_url: input.target_url,
      env: input.env,
    });
    if (!res.ok) {
      revalidatePath(`/projects/${input.project_slug}/qa`);
      return {
        ok: false,
        reason: res.reason,
        message: `Queued ${ids.length}/${types.length} — then ${t} failed: ${res.message ?? res.reason}`,
      };
    }
    ids.push(res.run_id);
  }
  revalidatePath(`/projects/${input.project_slug}/qa`);
  return { ok: true, data: { run_ids: ids } };
}

export async function cancelQaRunAction(input: {
  run_id: string;
  project_slug: string;
}): Promise<ActionResult> {
  const ok = await cancelQaRun(input.run_id);
  if (ok) {
    revalidatePath(`/projects/${input.project_slug}/qa`);
    return { ok: true };
  }
  return { ok: false, reason: "not-found-or-finished" };
}

export async function ingestQaRunAction(input: {
  project_slug: string;
  test_type: QaTestType;
  target_url: string;
  env?: QaEnv;
}): Promise<ActionResult<{ run_id: string }>> {
  const res = await ingestQaRun(input);
  if (res.ok) {
    revalidatePath(`/projects/${input.project_slug}/qa`);
    return { ok: true, data: { run_id: res.run_id } };
  }
  return { ok: false, reason: res.reason, message: res.message };
}

/**
 * Render the issue body for the currently-selected kosh findings.
 * Used by the "Copy as markdown" path on the client — no GitHub
 * round-trip needed for paste-into-Linear / paste-into-Slack.
 */
export async function buildKoshIssueBodyAction(input: {
  run_id: string;
  finding_ids: string[];
}): Promise<
  ActionResult<{ title: string; body: string; github_repo: string | null }>
> {
  const draft = await buildKoshIssueDraft({
    runId: input.run_id,
    findingIds: input.finding_ids,
  });
  if (!draft) {
    return { ok: false, reason: "no-selection-or-missing-report" };
  }
  return {
    ok: true,
    data: {
      title: draft.title,
      body: draft.body,
      github_repo: draft.github_repo,
    },
  };
}

/**
 * Shell out to `gh issue create` for the project's github_repo. Returns
 * the URL of the created issue.
 */
export async function createKoshGhIssueAction(input: {
  project_slug: string;
  run_id: string;
  finding_ids: string[];
}): Promise<ActionResult<{ url: string }>> {
  const draft = await buildKoshIssueDraft({
    runId: input.run_id,
    findingIds: input.finding_ids,
  });
  if (!draft) {
    return { ok: false, reason: "no-selection-or-missing-report" };
  }
  if (!draft.github_repo) {
    return {
      ok: false,
      reason: "no-github-repo",
      message:
        "Set a github_repo on the project (workbench → edit metadata) to enable GitHub issue creation.",
    };
  }
  const res = await createGhIssue({
    repo: draft.github_repo,
    title: draft.title,
    body: draft.body,
  });
  if (!res.ok) {
    return { ok: false, reason: "gh-failed", message: res.message };
  }
  revalidatePath(`/projects/${input.project_slug}/qa/${input.run_id}`);
  return { ok: true, data: { url: res.url } };
}
