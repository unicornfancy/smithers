"use client";

import { UserCheck } from "lucide-react";
import * as React from "react";

import { HandoffGeneratorDialog } from "@/components/handoff-generator-dialog";
import { Button } from "@/components/ui/button";

interface Props {
  projectSlug: string;
  defaultPreparedBy: string;
  label?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "ghost";
}

/**
 * Workbench affordance for the /project-handoff Hive Mind skill. Opens
 * the HandoffGeneratorDialog. Surfaced on the workbench when the
 * project is HM-connected (action degrades gracefully when it isn't).
 */
export function GenerateHandoffButton({
  projectSlug,
  defaultPreparedBy,
  label = "Generate handoff",
  size = "sm",
  variant = "outline",
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
        <UserCheck className="size-3.5" />
        {label}
      </Button>
      <HandoffGeneratorDialog
        open={open}
        onOpenChange={setOpen}
        projectSlug={projectSlug}
        defaultPreparedBy={defaultPreparedBy}
      />
    </>
  );
}
