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
}): Promise<ActionResult<{ run_id: string }>> {
  const res = await startQaRun(input);
  if (res.ok) {
    revalidatePath(`/projects/${input.project_slug}/qa`);
    return { ok: true, data: { run_id: res.run_id } };
  }
  return { ok: false, reason: res.reason, message: res.message };
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
