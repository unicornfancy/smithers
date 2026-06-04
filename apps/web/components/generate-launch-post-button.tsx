"use client";

import { Sparkles } from "lucide-react";
import * as React from "react";

import { LaunchPostGeneratorDialog } from "@/components/launch-post-generator-dialog";
import { Button } from "@/components/ui/button";

interface Props {
  projectSlug: string;
  defaultSiteUrl?: string;
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}

export function GenerateLaunchPostButton({
  projectSlug,
  defaultSiteUrl,
  label = "Generate launch post",
  variant = "default",
  size,
}: Props) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Sparkles className="size-3.5" />
        {label}
      </Button>
      <LaunchPostGeneratorDialog
        open={open}
        onOpenChange={setOpen}
        projectSlug={projectSlug}
        defaultSiteUrl={defaultSiteUrl}
      />
    </>
  );
}
