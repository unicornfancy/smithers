import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Renders markdown into Tailwind-styled HTML. Used for project bodies,
 * personal notes, and (eventually) AI-drafted output.
 *
 * Notes:
 * - GFM is on (tables, task list checkboxes, autolinks, strikethrough).
 * - Checkbox tasks render as plain disabled inputs that match the body
 *   typography rather than as a separate "Open Items" surface — those go
 *   through the dedicated parser in @smithers/vault.
 * - We keep all anchor links external-by-default with `noreferrer` so a stray
 *   markdown link in a draft doesn't carry referrer info.
 */
export function Markdown({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  return (
    <div className={cn(prose, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...rest }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                {...rest}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Hand-rolled prose styles tuned for the workbench. We don't pull in
 * @tailwindcss/typography to avoid the extra dependency for what amounts to a
 * dozen rules; this matches the rest of the UI (zinc, dark-mode-aware) more
 * tightly anyway.
 */
const prose = [
  "text-foreground/90 text-sm leading-relaxed",
  // Headings
  "[&_h1]:mt-0 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight",
  "[&_h3]:mt-5 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-medium",
  // Paragraphs and lists
  "[&_p]:my-2",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5",
  // Inline emphasis
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_em]:italic",
  // Code
  "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_code]:font-mono",
  "[&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:my-3 [&_pre]:overflow-x-auto",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[0.85em]",
  // Blockquote
  "[&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:my-3 [&_blockquote]:text-muted-foreground [&_blockquote]:italic",
  // HR
  "[&_hr]:my-5 [&_hr]:border-border",
  // Links — `text-primary` is essentially body color in the zinc theme,
  // so links became invisible. Use a real blue so anchors stand out at
  // a glance in both themes; the underline reinforces it.
  "[&_a]:text-sky-600 dark:[&_a]:text-sky-400 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-sky-700 dark:hover:[&_a]:text-sky-300",
  // Tables
  "[&_table]:my-3 [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse",
  "[&_th]:bg-muted [&_th]:text-left [&_th]:font-medium [&_th]:px-2 [&_th]:py-1 [&_th]:border [&_th]:border-border",
  "[&_td]:px-2 [&_td]:py-1 [&_td]:border [&_td]:border-border [&_td]:align-top",
  // Task list checkboxes
  "[&_input[type=checkbox]]:mr-1.5 [&_input[type=checkbox]]:translate-y-[1px]",
  "[&_li:has(>_input[type=checkbox])]:list-none [&_li:has(>_input[type=checkbox])]:-ml-5",
].join(" ");
