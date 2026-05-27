import * as React from "react";

interface Props {
  /** Stable id; matches the SettingsTabs entry that displays this section. */
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Wraps a tab's content with a heading + description block above the
 * cards. Each tab in SettingsTabs renders one of these.
 */
export function SettingsSection({ id, title, description, children }: Props) {
  return (
    <section id={id} className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-foreground text-lg font-semibold leading-tight">
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
