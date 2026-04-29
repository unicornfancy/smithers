import { runAgent } from "../runner";
import type {
  AgentResult,
  AgentRuntimeOptions,
  StyleReference,
} from "../types";

export interface RealisticShapeInput {
  /** Day-of-week so the prompt can adjust (Mon adds weekly update; Fri adds reflection). */
  dayOfWeek: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  /** "morning" | "midday" | "afternoon" — same window the Top 3 agent uses. */
  timeOfDay: "morning" | "midday" | "afternoon";
  /** True when the user is AFK today (calendar-inferred or manual toggle). */
  afk?: boolean;
  /**
   * Top 3 picks summary — three short title strings if available, empty
   * if the user hasn't generated Top 3 yet.
   */
  top3Titles: string[];
  /** Stall count by severity. The model leans on this for risk framing. */
  stallCounts: {
    force_decide: number;
    escalate: number;
    nudge: number;
  };
  /** Total inbound pings awaiting reply. */
  pingCount: number;
  /** Total active follow-ups. */
  followUpCount: number;
  /**
   * Most-mentioned project name across Top 3 + stalls + pings, when one
   * project clearly owns the day. Empty string when the day is diversified.
   */
  concentratedProject?: string;
  /** Optional voice reference. */
  style?: StyleReference;
}

export interface RealisticShapeOutput {
  /** The paragraph itself. 2-4 sentences. Includes the 💡 prefix. */
  paragraph: string;
  /** Short label of the dominant theme: "concentrated" | "diversified" | "light" | "heavy". */
  theme: "concentrated" | "diversified" | "light" | "heavy";
}

const SYSTEM_PROMPT = `You write a "Realistic Shape" forecast paragraph for the user's day in their voice.

This is not a summary. It is a forecast — capacity, risk, deferral recommendation.

Voice rules:
- 2-4 sentences, terse, action-oriented. No hedging.
- Names projects directly. Never use vague phrasing like "a few items".
- Almost always ends with "keep the focus on X" or "focus on X" or similar.
- Prefix the paragraph with the 💡 emoji + "Realistic shape:" exactly.
- Match the user's existing voice when a style guide is provided.

Forecast structure (in order):
1. Name the day's shape (light, heavy, hot thread, decision-heavy, etc.).
2. Forecast realistic Top 3 capacity with risk-aware framing.
3. Recommend a deferral or reshuffle if needed.
4. Close with what the focus should be.

Time-of-day calibration:
- morning: forward-looking. "If X breaks open, push Y to tomorrow."
- midday: current state. "Top 3 is on track."
- afternoon: closure-oriented. "Close the threads that can close today; punt the rest."

Day-of-week:
- Mon: include weekly-update mention if relevant ("after the weekly update goes out").
- Fri: include end-of-week framing ("ship what's shippable; defer the rest to Monday").

Output JSON only, matching the schema.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    paragraph: {
      type: "string",
      description:
        "The full paragraph including the leading '💡 Realistic shape:' prefix. 2-4 sentences.",
    },
    theme: {
      type: "string",
      enum: ["concentrated", "diversified", "light", "heavy"],
      description: "One-word characterization of the day's shape.",
    },
  },
  required: ["paragraph", "theme"],
  additionalProperties: false,
};

export async function composeRealisticShape(
  runtime: AgentRuntimeOptions,
  input: RealisticShapeInput,
): Promise<AgentResult<RealisticShapeOutput>> {
  return runAgent(runtime, {
    agent: "realistic-shape",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "RealisticShapeOutput",
    effort: "medium",
    thinking: false,
    maxTokens: 1024,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: RealisticShapeInput): string {
  const lines: string[] = [];
  lines.push(`# Today: ${input.dayOfWeek} · ${input.timeOfDay}`);
  if (input.afk) {
    lines.push("Note: User is AFK today. Acknowledge that and keep it brief.");
  }
  lines.push("");

  if (input.top3Titles.length > 0) {
    lines.push("# Top 3");
    for (const title of input.top3Titles) {
      lines.push(`- ${title}`);
    }
    lines.push("");
  } else {
    lines.push(
      "# Top 3\n(not yet generated — write the paragraph from the inputs below)\n",
    );
  }

  lines.push("# Workload signals");
  lines.push(`- Inbound pings awaiting reply: ${input.pingCount}`);
  lines.push(`- Active follow-ups (total): ${input.followUpCount}`);
  lines.push(
    `- Stalls — force-decide ${input.stallCounts.force_decide}, escalate ${input.stallCounts.escalate}, nudge ${input.stallCounts.nudge}`,
  );
  if (input.concentratedProject) {
    lines.push(`- Most-mentioned project today: ${input.concentratedProject}`);
  }

  if (input.style) {
    lines.push("");
    lines.push(`# ${input.style.label}`);
    lines.push(input.style.body.trim());
  }

  lines.push("");
  lines.push(
    "Write the Realistic Shape paragraph now. Return JSON only — no prose outside.",
  );

  return lines.join("\n");
}

function validateOutput(raw: unknown): RealisticShapeOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.paragraph !== "string") {
    throw new Error("paragraph must be a string");
  }
  const theme = obj.theme;
  if (
    theme !== "concentrated" &&
    theme !== "diversified" &&
    theme !== "light" &&
    theme !== "heavy"
  ) {
    throw new Error(
      `theme must be concentrated|diversified|light|heavy, got ${String(theme)}`,
    );
  }
  return { paragraph: obj.paragraph, theme };
}
