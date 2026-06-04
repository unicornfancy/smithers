"use client";

import * as React from "react";

import { SectionList, type SectionDef } from "@/components/section-list";
import { TabbedWorkbench } from "@/components/tabbed-workbench";
import { useWorkbenchLayout } from "@/lib/use-workbench-layout";

interface Props {
  projectSlug: string;
  sections: SectionDef[];
}

/**
 * Outer container that picks between the single-page (SectionList) and
 * tabbed layouts based on the user's localStorage pref. Both layouts
 * consume the same `sections` array — only one renders at a time, so
 * total work is 1x.
 *
 * Default is single-page (see useWorkbenchLayout), so existing users
 * see no change unless they opt into tabs via /settings.
 */
export function WorkbenchLayoutSwitcher({ projectSlug, sections }: Props) {
  const [layout] = useWorkbenchLayout();

  if (layout === "tabs") {
    return <TabbedWorkbench projectSlug={projectSlug} sections={sections} />;
  }
  return <SectionList scope="project" sections={sections} />;
}
