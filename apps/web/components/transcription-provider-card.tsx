"use client";

import * as React from "react";
import { Loader2, Mic } from "lucide-react";
import { toast } from "sonner";

import { updateTranscriptionProviderAction } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Provider = "fathom" | "granola" | "gemini" | "manual" | "whisper";

interface ProviderInfo {
  id: Provider;
  label: string;
  status: "shipped" | "stub";
  description: string;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: "fathom",
    label: "Fathom",
    status: "shipped",
    description:
      "Pulls recordings + transcripts via the Fathom MCP server. The default for existing users.",
  },
  {
    id: "granola",
    label: "Granola",
    status: "shipped",
    description:
      "Talks to Granola's public API. Requires GRANOLA_API_KEY in apps/web/.env.local.",
  },
  {
    id: "manual",
    label: "Manual paste",
    status: "shipped",
    description:
      "No upstream provider. Recent Calls renders empty; Process Call opens with a paste-area for the transcript.",
  },
  {
    id: "gemini",
    label: "Gemini (Google Meet transcripts)",
    status: "stub",
    description:
      "Not implemented yet — would search Drive for Gemini Assist transcript Docs. Picking this surfaces a config error on call lists.",
  },
  {
    id: "whisper",
    label: "Whisper (local)",
    status: "stub",
    description:
      "Not implemented yet — would transcribe uploaded audio files locally.",
  },
];

interface Props {
  initialProvider: Provider;
  granolaKeySet: boolean;
}

export function TranscriptionProviderCard({
  initialProvider,
  granolaKeySet,
}: Props) {
  const [provider, setProvider] = React.useState<Provider>(initialProvider);
  const [pending, startTransition] = React.useTransition();
  const initialRef = React.useRef(initialProvider);

  function select(next: Provider) {
    if (next === provider) return;
    setProvider(next);
    startTransition(async () => {
      const res = await updateTranscriptionProviderAction({ provider: next });
      if (res.ok) {
        toast.success(`Transcription provider set to ${next}`);
        initialRef.current = next;
      } else {
        toast.error(`Couldn't save: ${res.reason}`);
        setProvider(initialRef.current);
      }
    });
  }

  const needsGranolaKey = provider === "granola" && !granolaKeySet;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mic className="size-4" />
          Transcription provider
          {pending ? (
            <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
          ) : null}
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Which service Smithers reads call recordings + transcripts from.
          Stub providers are wired but not implemented — picking them surfaces
          a clear config error rather than a crash.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {PROVIDERS.map((p) => {
          const isActive = provider === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => select(p.id)}
              disabled={pending}
              aria-pressed={isActive}
              className={
                "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors " +
                (isActive
                  ? "border-foreground/40 bg-accent/40"
                  : "border-input hover:bg-accent/20")
              }
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {p.label}
                  {isActive ? (
                    <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                      Active
                    </span>
                  ) : null}
                  {p.status === "stub" ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                      Stub
                    </span>
                  ) : null}
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                  {p.description}
                </p>
              </div>
            </button>
          );
        })}
        {needsGranolaKey ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Granola is selected but{" "}
            <code className="bg-muted rounded px-1 font-mono text-[11px]">
              GRANOLA_API_KEY
            </code>{" "}
            isn&apos;t set. Set it via the API keys section on{" "}
            <a className="underline" href="/setup">
              /setup
            </a>
            .
          </p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          asChild
          className="mt-2 gap-1.5 text-xs"
        >
          <a href="/api/transcription/health" target="_blank" rel="noreferrer">
            Test current provider
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
