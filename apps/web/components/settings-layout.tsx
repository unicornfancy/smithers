import * as React from "react";

import { SettingsNav, type SettingsNavSection } from "@/components/settings-nav";

interface Props {
  sections: SettingsNavSection[];
  children: React.ReactNode;
}

/**
 * Two-column shell for /settings: sticky left rail with section nav +
 * the page content on the right. Each child should be a SettingsSection
 * keyed by an id that matches one of the sections passed in.
 *
 * On screens narrower than `lg` the rail stacks above the content as a
 * regular block. Anchor scrolling still works because every section's
 * heading has its own id.
 */
export function SettingsLayout({ sections, children }: Props) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
      <aside className="lg:sticky lg:top-6 lg:w-48 lg:shrink-0">
        <SettingsNav sections={sections} />
      </aside>
      <div className="min-w-0 flex-1 space-y-10">{children}</div>
    </div>
  );
}
