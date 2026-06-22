"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { reprocessExternalCallAction } from "@/app/calls/actions";
import { Button } from "@/components/ui/button";

interface Props {
  recordingId: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "ghost";
  label?: string;
}

/**
 * Re-run the analyze agent on a previously-imported external call,
 * using the transcript stored inline in its saved Call Notes file.
 * Same recording_id → same file rewritten in place, so reprocess
 * doesn't leave orphan files behind.
 */
export function ReprocessExternalCallButton({
  recordingId,
  size = "sm",
  variant = "outline",
  label = "Reprocess",
}: Props) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function handleClick() {
    setPending(true);
    try {
      const res = await reprocessExternalCallAction({ recording_id: recordingId });
      if (!res.ok) {
        toast.error(res.message ?? res.reason);
        return;
      }
      toast.success("Reprocessed");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      size={size}
      variant={variant}
      onClick={handleClick}
      disabled={pending}
      className="gap-1.5"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
      {label}
    </Button>
  );
}
