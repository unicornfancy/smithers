import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Write a launch-post image asset directly into the Hive Mind working
 * tree. The HM `write-project-file` MCP tool is utf-8-only, so binary
 * images bypass it and go through the local filesystem instead — fine
 * because Smithers runs locally and the HM repo is on the same disk.
 * The subsequent `mcp.hiveMind.commit` will pick up these files via
 * `git add -A`.
 *
 * Path-safety: every input is validated against the resolved assets
 * directory; any `..` or absolute filename that escapes the project's
 * assets/launched-<date>/ tree throws.
 */
export async function writeLaunchPostImage(args: {
  hiveMindRoot: string;
  partnerSlug: string;
  projectSlug: string;
  launchDate: string;
  filename: string;
  bytes: Buffer;
}): Promise<{ relative_path: string }> {
  assertSlug(args.partnerSlug, "partnerSlug");
  assertSlug(args.projectSlug, "projectSlug");
  assertLaunchDate(args.launchDate);
  assertFilename(args.filename);

  const assetsDir = path.resolve(
    args.hiveMindRoot,
    "knowledge",
    "partners",
    args.partnerSlug,
    args.projectSlug,
    "assets",
    `launched-${args.launchDate}`,
  );
  const targetPath = path.resolve(assetsDir, args.filename);
  if (!targetPath.startsWith(assetsDir + path.sep)) {
    throw new Error(
      `Image filename "${args.filename}" resolves outside the assets directory`,
    );
  }

  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(targetPath, args.bytes);

  return {
    relative_path: path.posix.join(
      "knowledge",
      "partners",
      args.partnerSlug,
      args.projectSlug,
      "assets",
      `launched-${args.launchDate}`,
      args.filename,
    ),
  };
}

function assertSlug(value: string, field: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`Invalid ${field} slug: "${value}"`);
  }
}

function assertLaunchDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`launch date must be YYYY-MM-DD, got "${value}"`);
  }
}

function assertFilename(value: string): void {
  if (
    !value ||
    value.includes("/") ||
    value.includes("\\") ||
    value.startsWith(".") ||
    value.length > 200
  ) {
    throw new Error(`Invalid image filename: "${value}"`);
  }
}
