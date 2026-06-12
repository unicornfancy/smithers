"use server";

import { revalidatePath } from "next/cache";

import {
  cancelQaRun,
  ingestQaRun,
  startQaRun,
  type QaEnv,
  type QaTestType,
} from "@/lib/server/kosh";

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
  const types: QaTestType[] = ["functional-design", "performance", "a11y"];
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
        message: `Queued ${ids.length}/3 — then ${t} failed: ${res.message ?? res.reason}`,
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
