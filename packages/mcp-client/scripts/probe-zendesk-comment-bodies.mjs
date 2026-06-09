// Probe Zendesk get-ticket-comments to see exactly what comment body
// text looks like for a known ticket — specifically whether outbound
// replies (from concierge@wordpress.com) carry the agent's signature
// in plain_body / body, and what form the signature takes.
//
// Run from repo root:
//   node packages/mcp-client/scripts/probe-zendesk-comment-bodies.mjs

import { spawn } from "node:child_process";

// Body Dao Acupuncture site ticket (per the project's frontmatter).
const TICKET_ID = 10957006;

const proc = spawn("npx", ["-y", "@automattic/mcp-context-a8c"], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
let nextId = 0;
const pending = new Map();

function send(method, params) {
  nextId += 1;
  const id = nextId;
  proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve) => pending.set(id, resolve));
}

proc.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (typeof msg.id === "number" && pending.has(msg.id)) {
        const r = pending.get(msg.id);
        pending.delete(msg.id);
        r(msg);
      }
    } catch {
      /* noise */
    }
  }
});

function extractText(result) {
  return (result?.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

async function main() {
  await new Promise((r) => setTimeout(r, 300));
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smithers-zendesk-probe", version: "0.0.1" },
  });
  proc.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  await new Promise((r) => setTimeout(r, 300));

  await send("tools/call", {
    name: "context-a8c-load-provider",
    arguments: { provider: "zendesk" },
  });

  console.log(`Fetching comments for ticket #${TICKET_ID}…`);
  const res = await send("tools/call", {
    name: "context-a8c-execute-tool",
    arguments: {
      provider: "zendesk",
      tool: "get-ticket-comments",
      params: { ticketId: TICKET_ID, includePrivate: false },
    },
  });

  if (res.error) {
    console.error("ERROR:", JSON.stringify(res.error, null, 2));
    proc.kill();
    process.exit(1);
  }

  const raw = extractText(res.result);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.log("Non-JSON response. Raw first 2000 chars:");
    console.log(raw.slice(0, 2000));
    proc.kill();
    process.exit(0);
  }

  const comments = parsed?.comments ?? parsed?.result ?? parsed ?? [];
  if (!Array.isArray(comments)) {
    console.log("Comments field shape unexpected. Top-level keys:", Object.keys(parsed ?? {}));
    console.log(JSON.stringify(parsed, null, 2).slice(0, 2000));
    proc.kill();
    process.exit(0);
  }

  console.log(`\nTotal comments: ${comments.length}\n`);
  // Show the LAST 4 comments (most recent first) — should include
  // Katie's recent nudge.
  const tail = comments.slice(-4);
  for (const c of tail) {
    console.log("=".repeat(70));
    console.log(`comment.id      = ${c.id ?? c.comment_id}`);
    console.log(`created_at      = ${c.created_at}`);
    console.log(`public          = ${c.public}`);
    console.log(`author.email    = ${c.author?.email ?? "(none)"}`);
    console.log(`author.name     = ${c.author?.name ?? "(none)"}`);
    console.log(`via.source.from = ${JSON.stringify(c.via?.source?.from ?? null)}`);
    console.log(`channel         = ${c.via?.channel ?? "(none)"}`);
    console.log("");
    const plain = c.plain_body ?? "";
    const html = c.body ?? "";
    console.log(`plain_body length: ${plain.length}`);
    console.log(`body length: ${html.length}`);
    console.log("");
    console.log("--- plain_body (first 600 chars) ---");
    console.log(plain.slice(0, 600));
    console.log("--- plain_body (last 400 chars / signature zone) ---");
    console.log(plain.slice(-400));
    if (!plain && html) {
      console.log("--- body (HTML, last 400 chars) ---");
      console.log(html.slice(-400));
    }
    console.log("");
    console.log(`Signature scan: includes "Katie McCanna"? ${
      /\bKatie McCanna\b/i.test(plain) || /\bKatie McCanna\b/i.test(html)
    }`);
    console.log(`               includes "Katie"?            ${
      /\bKatie\b/i.test(plain) || /\bKatie\b/i.test(html)
    }`);
  }

  proc.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error("Probe failed:", e);
  proc.kill();
  process.exit(1);
});

setTimeout(() => {
  console.error("Timed out.");
  proc.kill();
  process.exit(1);
}, 60_000);
