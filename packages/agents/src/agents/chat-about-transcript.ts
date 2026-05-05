import { getAnthropicClient } from "../client";
import type { AgentRuntimeOptions } from "../types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatAboutTranscriptInput {
  /** Full transcript text fetched from Fathom. */
  transcript: string;
  /** All prior conversation turns, not including the new user message. */
  history: ChatMessage[];
  /** The new question or message from the user. */
  userMessage: string;
}

/**
 * Multi-turn conversational Q&A about a call transcript. Sends the full
 * transcript as a user turn at the top of the conversation, followed by
 * the history and the new message, then returns Claude's reply as plain
 * text.
 *
 * Does not use structured output — we want a natural conversational reply,
 * not a JSON schema.
 */
export async function chatAboutTranscript(
  runtime: AgentRuntimeOptions,
  input: ChatAboutTranscriptInput,
): Promise<string> {
  const client = getAnthropicClient(runtime);

  // Build the message array. The transcript is sent as the first user
  // message so it benefits from prompt caching on repeated turns.
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: `Here is the call transcript:\n\n${input.transcript.trim()}`,
    },
    {
      role: "assistant",
      content:
        "Got it — I have the transcript. What would you like to know about the call?",
    },
    ...input.history,
    { role: "user", content: input.userMessage },
  ];

  const response = await client.messages.create({
    model: runtime.model ?? "claude-opus-4-7",
    max_tokens: 1024,
    system:
      "You are a helpful assistant with access to a call transcript. Answer questions about the call clearly and concisely. Use names from the transcript when referring to participants.",
    messages,
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in response");
  }
  return textBlock.text;
}
