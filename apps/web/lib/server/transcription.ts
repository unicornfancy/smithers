import "server-only";

import type {
  TranscriptionAdapter,
  TranscriptionProvider,
} from "@smithers/transcription";

import { loadConfig } from "@/lib/server/config";
import { FathomAdapter } from "@/lib/server/transcription/fathom";
import { GeminiAdapter } from "@/lib/server/transcription/gemini";
import { GranolaAdapter } from "@/lib/server/transcription/granola";
import { ManualAdapter } from "@/lib/server/transcription/manual";

/**
 * Resolve the transcription adapter the user has configured. Reads
 * `transcription.provider` from config.local.yaml (defaults to "fathom"
 * for backwards compat) and instantiates the matching adapter.
 *
 * Cached per-request via React's RSC cache (next-config sets
 * `dynamic = "force-dynamic"` on call surfaces so this re-evaluates on
 * each request anyway). No singleton — the adapter constructors are
 * cheap (no network until a method is called).
 */
export async function getTranscriptionAdapter(): Promise<TranscriptionAdapter> {
  const cfg = await loadConfig();
  const provider: TranscriptionProvider =
    cfg.transcription?.provider ?? "fathom";
  switch (provider) {
    case "fathom":
      return new FathomAdapter();
    case "granola": {
      const apiKey = process.env.GRANOLA_API_KEY ?? "";
      if (!apiKey) {
        // The adapter still gets constructed with an empty key; the
        // first API call will return ok:false / kind:"auth" so the UI
        // surfaces a clear "configure GRANOLA_API_KEY" message rather
        // than crashing.
      }
      return new GranolaAdapter({ apiKey });
    }
    case "gemini":
      return new GeminiAdapter();
    case "manual":
      return new ManualAdapter();
    case "whisper":
      // Whisper local-audio transcription is unimplemented — same
      // behaviour as gemini: return an adapter that fails listings
      // cleanly so the user sees a config error rather than a crash.
      return new GeminiAdapter();
  }
}
