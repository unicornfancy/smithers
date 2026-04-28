import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

/** Read a UTF-8 file, returning `null` if it doesn't exist. */
export async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export async function fileMtime(path: string): Promise<string | null> {
  try {
    const s = await stat(path);
    return s.mtime.toISOString();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/**
 * Atomic write: stage in a sibling temp file, fsync via rename.
 *
 * Why: a vault edit that crashes mid-write must not corrupt user data. Rename
 * is atomic on the same filesystem, so readers either see the old content or
 * the new — never a half-written file.
 */
export async function writeFileAtomic(
  path: string,
  contents: string,
): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.smithers-tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, contents, "utf-8");
  await rename(tmp, path);
}

/** List immediate entries of a directory; returns [] if the dir doesn't exist. */
export async function listDir(
  path: string,
): Promise<{ name: string; isDirectory: boolean; isFile: boolean }[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
    }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** List markdown files (`*.md`) directly under a directory. */
export async function listMarkdownFiles(path: string): Promise<string[]> {
  const entries = await listDir(path);
  return entries
    .filter((e) => e.isFile && e.name.toLowerCase().endsWith(".md"))
    .map((e) => e.name)
    .sort();
}
