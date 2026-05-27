"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface SettingsNavSection {
  /** DOM id used as the scroll anchor and the nav-link target. */
  id: string;
  label: string;
}

interface Props {
  sections: SettingsNavSection[];
}

/**
 * Left-rail nav for /settings. Two behaviors:
 *
 * 1. Click a section name → smooth-scroll to the matching anchor. Uses
 *    `scroll-margin-top` on the section heading so the destination
 *    lands below the app's sticky header.
 * 2. As the user scrolls the page, the section currently nearest the
 *    top is highlighted. We use IntersectionObserver against each
 *    section's anchor with a top-skewed rootMargin so the highlight
 *    flips at a comfortable threshold rather than the dead-center.
 */
export function SettingsNav({ sections }: Props) {
  const [activeId, setActiveId] = React.useState<string>(
    sections[0]?.id ?? "",
  );

  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Sort by viewport position so we always pick the topmost visible.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top,
          );
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        // Trigger when a section's top crosses ~25% from the top of
        // the viewport. The negative bottom margin shrinks the trigger
        // zone so we don't flip until the new section is genuinely
        // dominant on screen.
        rootMargin: "-15% 0px -70% 0px",
        threshold: [0, 0.1, 0.5, 1],
      },
    );

    const els: Element[] = [];
    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) {
        observer.observe(el);
        els.push(el);
      }
    }
    return () => {
      for (const el of els) observer.unobserve(el);
      observer.disconnect();
    };
  }, [sections]);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Update history so the URL reflects the section but doesn't add
    // a back-stack entry per click.
    history.replaceState(null, "", `#${id}`);
    setActiveId(id);
  }

  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
      {sections.map((section) => {
        const active = section.id === activeId;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={(e) => handleClick(e, section.id)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              active
                ? "bg-foreground text-background font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {section.label}
          </a>
        );
      })}
    </nav>
  );
}
