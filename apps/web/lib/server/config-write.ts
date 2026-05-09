import "server-only";

import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import yaml from "js-yaml";

/**
 * Helpers for atomically patching `config.local.yaml`. Used by /setup
 * and /settings to persist user-edited config without clobbering
 * unrelated fields. The pattern is always: read → structuredClone →
 * mutate → writeYamlAtomic. Atomic via tmp + rename so a crashed
 * write can't leave a half-truncated YAML file behind.
 */

export function configLocalPath(): string {
  return join(findRepoRoot(), "config.local.yaml");
}

export function findRepoRoot(): string {
  // We're at apps/web/.next/ etc — walk up two levels to repo root.
  return resolve(process.cwd(), "..", "..");
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function tryReadText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function readYamlFile(
  path: string,
): Promise<Record<string, unknown>> {
  const raw = await tryReadText(path);
  if (raw === null) return {};
  const parsed = yaml.load(raw);
  return isObject(parsed) ? parsed : {};
}

export async function writeYamlAtomic(
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  const out = yaml.dump(data, { indent: 2, lineWidth: 120, noRefs: true });
  await writeTextAtomic(path, out);
}

export async function writeTextAtomic(
  path: string,
  contents: string,
): Promise<void> {
  const tmp = `${path}.smithers-tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, contents, "utf-8");
  await rename(tmp, path);
}
