"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import type { HiveMindCallTranscript } from "@smithers/vault";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";

interface Props {
  transcript: HiveMindCallTranscript;
}

export function ViewTranscriptButton({ transcript }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        className="h-7 gap-1 px-2 text-xs"
      >
        <FileText className="size-3.5" />
        {open ? "Hide" : "View transcript"}
      </Button>
      {open ? (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border p-3 text-xs">
          <Markdown source={transcript.body} />
        </div>
      ) : null}
    </div>
  );
}
