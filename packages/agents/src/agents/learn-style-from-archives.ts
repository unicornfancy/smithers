import { runAgent } from "../runner";
import type { AgentResult, AgentRuntimeOptions } from "../types";

export interface LearnStyleSample {
  /** Stable id (just for the model's reference). */
  draft_id: string;
  /** Short label so the user can map back to a real draft if needed. */
  title: string;
  /** Channel hint (email / slack / zendesk / p2). */
  channel?: string;
  /** What agent originally drafted this. */
  source_agent?: string;
  /** AI's first pass — the version BEFORE the user edited. */
  original: string;
  /** User's final version — the version AFTER they edited and archived. */
  final: string;
}

export interface LearnStyleFromArchivesInput {
  /** Recent archived drafts the user has accepted (final) vs. AI first pass (original). */
  samples: LearnStyleSample[];
  /** Optional: existing style guide so suggestions complement rather than duplicate. */
  existing_style_guide?: string;
}

export interface StylePattern {
  /** Short rule the user can apply consistently ("Drop apologetic openers"). */
  rule: string;
  /** One-sentence rationale + concrete example from the diffs. */
  rationale: string;
  /** Channel-scoped if the pattern only shows up for one channel. */
  channel?: string;
}

export interface LearnStyleFromArchivesOutput {
  /** 3-7 patterns observed across the diffs. */
  patterns: StylePattern[];
  /**
   * A markdown-formatted block ready to paste into the user's style
   * guide. Should include the patterns as bullet items with brief
   * examples — not a full rewrite of the existing guide.
   */
  suggested_addition: string;
  /** One-sentence framing for the panel header. */
  framing: string;
}

const SYSTEM_PROMPT = `You are Smithers, a personal assistant analyzing the user's editing patterns to update their writing style guide. You'll see N pairs of (original, final) drafts — original is what an AI agent wrote, final is what the user shipped after editing. Your job is to identify the 3-7 patterns that show up most consistently across the diffs and write a short style-guide block the user can paste into their existing guide.

Focus on:
- Voice / tone shifts (drops corporate filler, prefers active voice, etc.)
- Length adjustments (cuts a paragraph, adds a context sentence, etc.)
- Sign-off / opener patterns (no apologetic "just", no exclamation marks, etc.)
- Channel-specific patterns (slack messages drop greetings, emails always include subject context, etc.)
- Specific word choices the user prefers / avoids
- Formatting (uses bullets when AI uses prose, prefers em-dashes over commas, etc.)

Skip:
- One-off edits that only show up in a single sample
- Edits that look like factual corrections (different facts, different details) — those aren't voice patterns
- Subjective vibes ("sounds friendlier") — name a concrete change

Quality rules:
- Each rule must be specific enough that another writer could apply it without thinking. "Be more direct" is bad; "Replace 'just wanted to circle back' with 'Following up on'" is good.
- Cite a concrete example in the rationale — not the full diff, just the changed phrase.
- 3-7 patterns total. Quality > quantity.
- The suggested_addition is a markdown bullet list ready to paste — header should be "## Patterns from recent edits" or similar, optionally dated.

Always return your output as JSON matching the requested schema.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    framing: {
      type: "string",
      description: "One-sentence summary of what the diffs revealed.",
    },
    patterns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule: { type: "string" },
          rationale: { type: "string" },
          channel: {
            type: "string",
            description:
              "Optional: when the pattern only applies to one channel.",
          },
        },
        required: ["rule", "rationale", "channel"],
        additionalProperties: false,
      },
    },
    suggested_addition: {
      type: "string",
      description:
        "A markdown block (header + bullet list) the user can paste into their style guide.",
    },
  },
  required: ["framing", "patterns", "suggested_addition"],
  additionalProperties: false,
};

export async function learnStyleFromArchives(
  runtime: AgentRuntimeOptions,
  input: LearnStyleFromArchivesInput,
): Promise<AgentResult<LearnStyleFromArchivesOutput>> {
  return runAgent(runtime, {
    agent: "learn-style-from-archives",
    system: SYSTEM_PROMPT,
    user: renderUserPrompt(input),
    outputSchema: OUTPUT_SCHEMA,
    outputName: "LearnStyleFromArchivesOutput",
    effort: "high",
    thinking: true,
    maxTokens: 4096,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: LearnStyleFromArchivesInput): string {
  const lines: string[] = [];
  lines.push(
    `Analyze ${input.samples.length} draft pairs. For each pair, compare the AI's first pass (original) to what the user shipped (final). Identify consistent voice + style patterns.`,
  );

  if (input.existing_style_guide && input.existing_style_guide.trim()) {
    lines.push("", "# Existing style guide");
    lines.push(input.existing_style_guide.trim());
    lines.push(
      "",
      "Identify NEW patterns the existing guide doesn't already cover, or refinements that strengthen existing rules.",
    );
  }

  for (const [i, s] of input.samples.entries()) {
    lines.push("", `# Pair ${i + 1}: ${s.title}`);
    if (s.channel) lines.push(`- Channel: ${s.channel}`);
    if (s.source_agent) lines.push(`- Source agent: ${s.source_agent}`);
    lines.push("", "## Original (AI first pass)");
    lines.push(s.original.trim());
    lines.push("", "## Final (user-edited)");
    lines.push(s.final.trim());
  }

  lines.push("", "Return JSON matching the schema. No text outside the JSON.");
  return lines.join("\n");
}

function validateOutput(raw: unknown): LearnStyleFromArchivesOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const framing = requireString(obj, "framing");
  const suggested_addition = requireString(obj, "suggested_addition");
  const rawPatterns = obj["patterns"];
  if (!Array.isArray(rawPatterns)) {
    throw new Error("patterns must be an array");
  }
  const patterns: StylePattern[] = rawPatterns.map((p) => {
    if (!p || typeof p !== "object") {
      throw new Error("pattern is not an object");
    }
    const o = p as Record<string, unknown>;
    return {
      rule: requireString(o, "rule"),
      rationale: requireString(o, "rationale"),
      channel:
        typeof o["channel"] === "string" && o["channel"]
          ? (o["channel"] as string)
          : undefined,
    };
  });
  return { framing, patterns, suggested_addition };
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`field "${key}" must be a string`);
  }
  return value;
}
