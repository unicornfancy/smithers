// Probe ContextA8C's wpcom + mgs providers to see whether the post +
// per-post-comment tools that were missing on 2026-05-28 (and led to
// the P2 chip being cut from the Live Activity feed in 1538a03) have
// landed. Uses Smithers' production ContextA8C path — `~/.mcp-auth/`
// auth, same transport `getMcpClient` uses on the server side.
//
// Run from repo root:
//   node packages/mcp-client/scripts/probe-wpcom-p2.mjs

import { spawn } from "node:child_process";

const proc = spawn("npx", ["-y", "@automattic/mcp-context-a8c"], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
let nextId = 0;
const pending = new Map();

function send(method, params) {
  nextId += 1;
  const id = nextId;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  proc.stdin.write(`${msg}\n`);
  return new Promise((resolve) => {
    pending.set(id, resolve);
  });
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
        const resolve = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch {
      /* non-JSON noise, ignore */
    }
  }
});

function extractTextContent(result) {
  const content = result?.content ?? [];
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

async function call(provider, subtool, subtool_args) {
  return send("tools/call", {
    name: "context-a8c-execute-tool",
    arguments: { provider, subtool, subtool_args },
  });
}

async function main() {
  await new Promise((r) => setTimeout(r, 300));
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smithers-p2-probe", version: "0.0.1" },
  });
  proc.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  await new Promise((r) => setTimeout(r, 300));

  // Load providers (need to load before subtools are callable)
  await send("tools/call", {
    name: "context-a8c-load-provider",
    arguments: { provider: "wpcom" },
  });
  await send("tools/call", {
    name: "context-a8c-load-provider",
    arguments: { provider: "mgs" },
  });

  // === 1. Discover P2s the user can access ===
  console.log("=".repeat(70));
  console.log("1. wpcom/p2-sites — discover internal P2 IDs");
  console.log("=".repeat(70));
  const p2sites = await call("wpcom", "p2-sites", {
    search: "special projects",
    per_page: 5,
  });
  console.log(extractTextContent(p2sites.result).slice(0, 1500));

  // === 2. Resolve and fetch a real team P2 with comments ===
  console.log("");
  console.log("=".repeat(70));
  console.log("2. wpcom/posts-text on to51.wordpress.com (team P2) WITH comments");
  console.log("=".repeat(70));
  const since = new Date();
  since.setDate(since.getDate() - 14);

  const teamP2 = await call("wpcom", "posts-text", {
    site: "to51.wordpress.com",
    per_page: 2,
    after: since.toISOString(),
    include_comments: true,
    max_comments_per_post: 10,
  });
  if (teamP2.error) {
    console.log("ERROR:", JSON.stringify(teamP2.error, null, 2));
  } else {
    const text = extractTextContent(teamP2.result);
    // Try to parse JSON and pretty-print just the structure of one post
    try {
      const parsed = JSON.parse(text);
      const post = (parsed.posts ?? parsed.results ?? [])[0];
      if (post) {
        console.log("First post shape:");
        console.log(JSON.stringify({
          ID: post.ID ?? post.id,
          slug: post.slug ?? post.post_name,
          title: post.title,
          date: post.date,
          comments_total: post.comments_total,
          comments_truncated: post.comments_truncated,
          comments_count: Array.isArray(post.comments) ? post.comments.length : null,
          sample_comment: Array.isArray(post.comments) && post.comments[0] ? {
            ID: post.comments[0].ID ?? post.comments[0].id,
            author: post.comments[0].author?.name ?? post.comments[0].author,
            date: post.comments[0].date,
            content_preview: (post.comments[0].content ?? "").slice(0, 120),
          } : null,
        }, null, 2));
        console.log(`\nTotal posts in response: ${(parsed.posts ?? parsed.results ?? []).length}`);
      } else {
        console.log("No posts in response. Raw start:");
        console.log(text.slice(0, 800));
      }
    } catch {
      console.log("Non-JSON response; raw:");
      console.log(text.slice(0, 1200));
    }
  }

  // === 3. mgs/search filtered to a single P2 ===
  console.log("");
  console.log("=".repeat(70));
  console.log("3. mgs/search filtered to team P2 (blog_id 70172480), content_type=comment");
  console.log("=".repeat(70));
  const mgs = await call("mgs", "search", {
    query: "pocket nyc",
    sites: [70172480],
    content_type: "comment",
    per_page: 3,
    sort: "date_desc",
  });
  const mgsText = extractTextContent(mgs.result);
  try {
    const parsed = JSON.parse(mgsText);
    const hits = parsed.results ?? [];
    console.log(`Hits: ${hits.length}`);
    for (const h of hits.slice(0, 3)) {
      console.log({
        type: h.type,
        post_title: h.post_title,
        date: h.date,
        author: h.author,
        url: h.url,
        excerpt_preview: (h.excerpt ?? "").slice(0, 100),
      });
    }
  } catch {
    console.log(mgsText.slice(0, 800));
  }

  proc.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error("Probe failed:", err);
  proc.kill();
  process.exit(1);
});

setTimeout(() => {
  console.error("Timed out — killing probe.");
  proc.kill();
  process.exit(1);
}, 60_000);
