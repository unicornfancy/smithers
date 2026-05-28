"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";

import {
  BriefGeneratorDialog,
  type TranscriptOption,
} from "@/components/brief-generator-dialog";
import { Button } from "@/components/ui/button";

export type { TranscriptOption } from "@/components/brief-generator-dialog";

interface Props {
  projectSlug: string;
  transcripts: TranscriptOption[];
  initialDiscoveryDocUrl: string;
  initialRegistrar: string;
  initialDns: string;
  label?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "ghost";
}

export function GenerateBriefButton({
  projectSlug,
  transcripts,
  initialDiscoveryDocUrl,
  initialRegistrar,
  initialDns,
  label = "Generate brief",
  size = "sm",
  variant = "default",
}: Props) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        size={size}
        variant={variant}
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Sparkles className="size-3.5" />
        {label}
      </Button>
      <BriefGeneratorDialog
        open={open}
        onOpenChange={setOpen}
        projectSlug={projectSlug}
        transcripts={transcripts}
        initialDiscoveryDocUrl={initialDiscoveryDocUrl}
        initialRegistrar={initialRegistrar}
        initialDns={initialDns}
      />
    </>
  );
}
