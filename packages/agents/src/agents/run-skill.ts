import { runAgent } from "../runner";
import type { AgentResult, AgentRuntimeOptions } from "../types";

/**
 * Generic skill-runner agent. Used to execute Hive-Mind skills (like
 * /create-brief) from outside an interactive Claude Code session.
 *
 * The skill's SKILL.md body becomes the system prompt; supporting
 * files (templates, knowledge catalogs, reference briefs) are
 * loaded by Smithers and passed in alongside the user-supplied
 * inputs. The agent returns the skill's intended output as a
 * markdown string.
 *
 * Why generic rather than a `generate-brief`-specific agent: this
 * same runner handles /project-handoff, /update-knowledge, and any
 * future skill that produces a single markdown artifact. Skill
 * authors get one agent contract to target.
 */

export interface RunSkillInput {
  /** The skill's slug — used in the user prompt for context. */
  skill_slug: string;
  /** SKILL.md body, frontmatter stripped. Becomes the system prompt. */
  skill_prompt: string;
  /**
   * Files declared in the skill's `dependencies` frontmatter, keyed
   * by HM-relative path. Loaded by Smithers via `getHiveMindSkillContent`.
   */
  dependency_files: Record<string, string>;
  /**
   * Free-form context Smithers gathered for this run — project info,
   * transcripts, Discovery Doc, registrar, etc. The agent treats this
   * as already-collected input, so the skill's "ask the user" steps
   * are skipped.
   */
  inputs_markdown: string;
}

export interface RunSkillOutput {
  /** Skill output as a single markdown document. */
  markdown: string;
  /**
   * Any questions the agent flagged for follow-up. Surfaced in the
   * review UI so Katie can capture them before saving the artifact.
   */
  questions: string[];
}

const SYSTEM_FRAMING = `You are running a Hive Mind skill on behalf of Smithers. The skill's full prompt body is included below verbatim. Follow it precisely.

CRITICAL NOTES:
- Smithers has pre-gathered every input the skill normally asks the user for. Skip any "ask the user" or "stop and request" steps — treat the inputs as provided.
- If the skill instructs you to read a file (e.g., "read templates/project-brief.md"), look for the file's content in the user message under "Dependency files".
- The artifact you produce is the skill's intended output (typically a markdown document). Return it under \`markdown\` in the response.
- Any open questions or missing inputs the skill would ordinarily ask the user about — list them under \`questions\` so Smithers can surface them for follow-up.

--- BEGIN SKILL ---

`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    markdown: {
      type: "string",
      description:
        "The skill's intended output document, as a single markdown string. Frontmatter at the top is fine when the template includes it.",
    },
    questions: {
      type: "array",
      description:
        "Items the skill would normally raise with the user (missing inputs, conflicts between sources, ambiguous decisions).",
      items: { type: "string" },
    },
  },
  required: ["markdown", "questions"],
  additionalProperties: false,
};

export async function runHiveMindSkill(
  runtime: AgentRuntimeOptions,
  input: RunSkillInput,
): Promise<AgentResult<RunSkillOutput>> {
  const system = `${SYSTEM_FRAMING}${input.skill_prompt}\n\n--- END SKILL ---`;
  const user = renderUserPrompt(input);
  return runAgent(runtime, {
    agent: "run-skill",
    system,
    user,
    outputSchema: OUTPUT_SCHEMA,
    outputName: "RunSkillOutput",
    effort: "high",
    thinking: false,
    maxTokens: 16000,
    validate: validateOutput,
  });
}

function renderUserPrompt(input: RunSkillInput): string {
  const sections: string[] = [
    `# Skill run: /${input.skill_slug}`,
    "",
    "## Inputs Smithers gathered for this run",
    "",
    input.inputs_markdown,
    "",
  ];
  const depPaths = Object.keys(input.dependency_files).sort();
  if (depPaths.length > 0) {
    sections.push("## Dependency files");
    sections.push("");
    sections.push(
      "Each file the skill references is included below verbatim. The path is the file's location in the Hive Mind clone, relative to its root.",
    );
    sections.push("");
    for (const path of depPaths) {
      sections.push(`### \`${path}\``);
      sections.push("");
      sections.push("```markdown");
      sections.push(input.dependency_files[path]!);
      sections.push("```");
      sections.push("");
    }
  }
  return sections.join("\n");
}

function validateOutput(raw: unknown): RunSkillOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("output is not an object");
  }
  const o = raw as Partial<RunSkillOutput>;
  if (typeof o.markdown !== "string" || o.markdown.length === 0) {
    throw new Error("output.markdown missing or empty");
  }
  if (!Array.isArray(o.questions)) {
    throw new Error("output.questions must be an array");
  }
  return {
    markdown: o.markdown,
    questions: o.questions.filter((q): q is string => typeof q === "string"),
  };
}
