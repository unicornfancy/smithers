import * as React from "react";

interface Props {
  /** Anchor target. Must match the `id` field of one of SettingsLayout's sections. */
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Wraps a settings section with an anchored heading. The `id` is what
 * the left-rail nav scrolls to; `scroll-mt` reserves space so the
 * heading lands below the app's sticky header rather than tucked
 * under it.
 */
export function SettingsSection({ id, title, description, children }: Props) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4">
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
