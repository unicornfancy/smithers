// Ordered list of my-voice skill files. Kept in a plain (non-server) module
// so both server helpers and client components can import it.

export const MY_VOICE_FILES: readonly { filename: string; label: string }[] = [
  { filename: "SKILL.md", label: "Voice & Style" },
  { filename: "PARTNER_COMMS.md", label: "Partner Comms" },
  { filename: "INTERNAL_STYLE_GUIDE.md", label: "Internal Style" },
  { filename: "EXTERNAL_STYLE_GUIDE.md", label: "External Style" },
  { filename: "REPORT_STRUCTURE.md", label: "Report Structure" },
] as const;
