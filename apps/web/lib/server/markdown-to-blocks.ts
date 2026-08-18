import "server-only";

import { marked, type Token, type Tokens } from "marked";

/**
 * Markdown → serialized Gutenberg blocks, for posting P2 comments.
 *
 * P2 (o2/p2020) edits comments in the block editor. If we send plain
 * markdown, the server converts it to bare HTML with no block
 * delimiters and the editor shows the whole comment as one Classic
 * block. Emitting `<!-- wp:paragraph -->`-style markup ourselves
 * matches what P2's own editor writes (verified against a UI-authored
 * SITREP comment on team51projects, 2026-08).
 *
 * The API save path re-serializes all-block comments through an
 * allowlist (probed 2026-08-18 on team51projects): paragraph, list,
 * list-item, quote and code SURVIVE; heading, html, separator, table
 * and preformatted are silently DROPPED. So everything here is
 * expressed with the surviving five — headings become bold paragraphs,
 * tables become a list of rows, rules are skipped, raw HTML is
 * flattened to text. Nothing the agent wrote is ever lost.
 */
export function markdownToBlocks(markdown: string): string {
  const src = markdown.replace(/\r\n?/g, "\n").trim();
  if (!src) return "";
  const tokens = marked.lexer(src, { gfm: true });
  return renderBlocks(tokens).join("\n\n");
}

function renderBlocks(tokens: Token[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    const block = renderBlock(t);
    if (block) out.push(block);
  }
  return out;
}

function renderBlock(t: Token): string | null {
  switch (t.type) {
    case "space":
      return null;
    case "heading":
      // Heading blocks are stripped on the API path — bold paragraph.
      return paragraph(`<strong>${inline((t as Tokens.Heading).tokens)}</strong>`);
    case "paragraph":
      return paragraph(inline((t as Tokens.Paragraph).tokens));
    case "text": {
      // Bare text at block level (loose list items etc.) — treat as a paragraph.
      const tt = t as Tokens.Text;
      return paragraph(tt.tokens ? inline(tt.tokens) : escapeHtml(tt.text));
    }
    case "list":
      return list(t as Tokens.List);
    case "blockquote": {
      const inner = renderBlocks((t as Tokens.Blockquote).tokens).join("\n\n");
      return `<!-- wp:quote -->\n<blockquote class="wp-block-quote">${inner}</blockquote>\n<!-- /wp:quote -->`;
    }
    case "code":
      return `<!-- wp:code -->\n<pre class="wp-block-code"><code>${escapeHtml((t as Tokens.Code).text)}</code></pre>\n<!-- /wp:code -->`;
    case "hr":
      // Separator blocks are stripped on the API path; nothing to lose.
      return null;
    case "table":
      return table(t as Tokens.Table);
    case "html": {
      // html blocks are stripped on the API path — keep the text.
      const text = (t as Tokens.HTML).raw.replace(/<[^>]+>/g, "").trim();
      return text ? paragraph(escapeHtml(text)) : null;
    }
    default: {
      // Unknown block token: keep the content rather than dropping it.
      const anyTok = t as { tokens?: Token[]; text?: string; raw?: string };
      if (anyTok.tokens?.length) return paragraph(inline(anyTok.tokens));
      const text = (anyTok.text ?? anyTok.raw ?? "").trim();
      return text ? paragraph(escapeHtml(text)) : null;
    }
  }
}

function paragraph(innerHtml: string): string {
  return `<!-- wp:paragraph -->\n<p>${innerHtml}</p>\n<!-- /wp:paragraph -->`;
}

function list(l: Tokens.List): string {
  const tag = l.ordered ? "ol" : "ul";
  const attrs = l.ordered ? ` {"ordered":true}` : "";
  const items = l.items.map((item) => listItem(item)).join("\n\n");
  // Mirrors the editor's serialization: no newline between the list
  // tag and the first/last item delimiters.
  return `<!-- wp:list${attrs} -->\n<${tag} class="wp-block-list">${items}</${tag}>\n<!-- /wp:list -->`;
}

function listItem(item: Tokens.ListItem): string {
  const parts: string[] = [];
  const nested: string[] = [];
  for (const t of item.tokens) {
    if (t.type === "list") {
      nested.push(list(t as Tokens.List));
    } else if (t.type === "text" || t.type === "paragraph") {
      const tt = t as Tokens.Text | Tokens.Paragraph;
      parts.push(tt.tokens ? inline(tt.tokens) : escapeHtml((tt as Tokens.Text).text));
    } else if (t.type !== "space") {
      // A code block / quote inside a list item — flatten to text.
      const block = renderBlock(t);
      if (block) nested.push(block);
    }
  }
  const prefix = item.task ? (item.checked ? "[x] " : "[ ] ") : "";
  // Multi-paragraph items: join with a break so nothing is lost.
  const body = prefix + parts.join("<br>");
  return `<!-- wp:list-item -->\n<li>${body}${nested.join("")}</li>\n<!-- /wp:list-item -->`;
}

function table(t: Tokens.Table): string {
  // Table blocks are stripped on the API path — one list item per row,
  // "Header: cell" pairs, so the data survives even if the grid doesn't.
  const headers = t.header.map((c) => inline(c.tokens));
  const items = t.rows.map((r) => {
    const cells = r.map((c, i) => {
      const h = headers[i];
      const v = inline(c.tokens);
      return h ? `<strong>${h}:</strong> ${v}` : v;
    });
    return `<!-- wp:list-item -->\n<li>${cells.join(" · ")}</li>\n<!-- /wp:list-item -->`;
  });
  return `<!-- wp:list -->\n<ul class="wp-block-list">${items.join("\n\n")}</ul>\n<!-- /wp:list -->`;
}

function inline(tokens: Token[]): string {
  return marked.Parser.parseInline(tokens, { gfm: true }).trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
