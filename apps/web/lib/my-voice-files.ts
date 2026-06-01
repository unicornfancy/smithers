// Ordered list of my-voice skill files. Kept in a plain (non-server) module
// so both server helpers and client components can import it.

export const MY_VOICE_FILES: readonly { filename: string; label: string }[] = [
  { filename: "SKILL.md", label: "Voice & Style" },
  { filename: "PARTNER_COMMS.md", label: "Partner Comms" },
  { filename: "INTERNAL_STYLE_GUIDE.md", label: "Internal Style" },
  { filename: "EXTERNAL_STYLE_GUIDE.md", label: "External Style" },
  { filename: "REPORT_STRUCTURE.md", label: "Report Structure" },
  { filename: "WEEKLY_UPDATE_STYLE.md", label: "Weekly Update Style" },
  // Job context — who the user is, what their team does, common
  // collaborators + vocabulary. Loaded by every voice-aware agent
  // alongside the style files. Written to be partner-safe in v1 so it
  // can ride along with partner-facing drafts; split into
  // INTERNAL_/EXTERNAL_JOB_CONTEXT later if leakage becomes a concern.
  { filename: "JOB_CONTEXT.md", label: "Job Context" },
] as const;
