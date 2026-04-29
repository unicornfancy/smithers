import "server-only";

import type {
  RealisticShapeOutput,
  TopThreeOutput,
} from "@smithers/agents";

import { getVault } from "./vault";

/**
 * Render Top 3 picks as the body of the smithers:top-3 daily-note
 * section. Numbered list, bold title, why-statement, italicized
 * next-action — Obsidian renders this cleanly without any plugins.
 */
export function formatTopThreeSection(output: TopThreeOutput): string {
  const lines: string[] = [];
  lines.push("## Top 3");
  lines.push("");
  output.picks.forEach((pick, i) => {
    lines.push(`${i + 1}. **${pick.title}**`);
    lines.push(`   ${pick.why}`);
    lines.push(`   *Next action:* ${pick.next_action}`);
    if (i < output.picks.length - 1) lines.push("");
  });
  if (output.framing) {
    lines.push("");
    lines.push(`> ${output.framing}`);
  }
  return lines.join("\n");
}

export function formatRealisticShapeSection(
  output: RealisticShapeOutput,
): string {
  return ["## Realistic shape", "", output.paragraph.trim()].join("\n");
}

/**
 * Persist agent output to today's daily note. Logs errors but never
 * throws — writeback is a side-effect of the agent call, not the
 * primary contract, so a failed write shouldn't break the API
 * response that already got the user the picks they asked for.
 */
export async function writeTopThreeToDailyNote(
  output: TopThreeOutput,
  date: string = isoDate(),
): Promise<void> {
  try {
    const vault = await getVault();
    await vault.upsertDailySection(date, "top-3", formatTopThreeSection(output));
  } catch (err) {
    console.error("[smithers] Top 3 daily-note writeback failed:", err);
  }
}

export async function writeRealisticShapeToDailyNote(
  output: RealisticShapeOutput,
  date: string = isoDate(),
): Promise<void> {
  try {
    const vault = await getVault();
    await vault.upsertDailySection(
      date,
      "realistic-shape",
      formatRealisticShapeSection(output),
    );
  } catch (err) {
    console.error(
      "[smithers] Realistic Shape daily-note writeback failed:",
      err,
    );
  }
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
