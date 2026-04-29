import "server-only";

import type {
  RealisticShapeOutput,
  TopThreeOutput,
} from "@smithers/agents";

import { detectStalls, type StallItem, type StallSummary } from "./stalls";
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
 * Render the day's stalls grouped by severity bucket. Returns the
 * empty-state line when nothing's stalled, so the daily note still
 * documents that fact rather than leaving the section absent.
 */
export function formatStallsSection(summary: StallSummary): string {
  if (summary.items.length === 0) {
    return "## Stalls & closures\n\n*Nothing stalled today.*";
  }
  const lines: string[] = ["## Stalls & closures", ""];
  const groups: ReadonlyArray<{
    severity: StallItem["severity"];
    label: string;
  }> = [
    { severity: "force_decide", label: "Force a decision" },
    { severity: "escalate", label: "Escalate or accept" },
    { severity: "nudge", label: "Send a nudge" },
    { severity: "next_nudge_upcoming", label: "Touchpoint reminders" },
  ];
  for (const group of groups) {
    const items = summary.items.filter((i) => i.severity === group.severity);
    if (items.length === 0) continue;
    lines.push(`### ${group.label} · ${items.length}`);
    for (const item of items) {
      lines.push(`- **${item.title}** — ${item.context}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
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

/**
 * Snapshot the current stall state into the daily note. Triggered
 * alongside the Top 3 writeback (the morning-briefing moment), so
 * the markdown captures the state of the day's decision queue at
 * the time the user generated their picks.
 */
export async function writeStallsToDailyNote(
  date: string = isoDate(),
): Promise<void> {
  try {
    const vault = await getVault();
    const summary = await detectStalls({ vault });
    await vault.upsertDailySection(
      date,
      "stalls",
      formatStallsSection(summary),
    );
  } catch (err) {
    console.error("[smithers] Stalls daily-note writeback failed:", err);
  }
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
