// Probe matticspace for ways to find Team 51 contract designers/devs.
//   node --import tsx/esm packages/mcp-client/scripts/probe-team-51-contractors.mjs

import { spawn } from "node:child_process";

const proc = spawn("npx", ["-y", "@automattic/mcp-context-a8c"], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
let id = 0;
const pending = new Map();

function call(toolName, params) {
  return new Promise((resolve) => {
    id += 1;
    pending.set(id, resolve);
    proc.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: toolName, arguments: params },
      })}\n`,
    );
  });
}

function send(method, params) {
  id += 1;
  proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
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
      const resolver = pending.get(msg.id);
      if (resolver) {
        pending.delete(msg.id);
        let payload = null;
        if (msg.result?.content?.[0]?.text) {
          try {
            payload = JSON.parse(msg.result.content[0].text);
          } catch {
            payload = msg.result.content[0].text;
          }
        }
        resolver(payload);
      }
    } catch {
      // ignore
    }
  }
});

async function main() {
  // bootstrap
  await new Promise((r) => setTimeout(r, 200));
  send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "probe", version: "0.0.1" },
  });
  await new Promise((r) => setTimeout(r, 500));
  send("notifications/initialized", {});
  await new Promise((r) => setTimeout(r, 200));

  // ---- Approach 1: search-groups for Team 51 / contractor / vendor ----
  console.log("\n=== search-groups query='team 51':");
  let r = await call("context-a8c-execute-tool", {
    provider: "matticspace",
    tool: "search-groups",
    params: { query: "team 51" },
  });
  console.log(JSON.stringify(r, null, 2));

  console.log("\n=== search-groups query='contractor':");
  r = await call("context-a8c-execute-tool", {
    provider: "matticspace",
    tool: "search-groups",
    params: { query: "contractor" },
  });
  console.log(JSON.stringify(r, null, 2));

  console.log("\n=== search-groups query='special projects':");
  r = await call("context-a8c-execute-tool", {
    provider: "matticspace",
    tool: "search-groups",
    params: { query: "special projects" },
  });
  console.log(JSON.stringify(r, null, 2));

  // ---- Approach 2: search-automatticians with role_type filter ----
  console.log("\n=== search-automatticians query='contractor' field=role:");
  r = await call("context-a8c-execute-tool", {
    provider: "matticspace",
    tool: "search-automatticians",
    params: {
      query: "contractor",
      fields: ["role"],
      returned_fields: ["name", "wp_username", "job_title", "role", "role_type", "team_group"],
    },
  });
  console.log(JSON.stringify(r, null, 2));

  console.log("\n=== search-automatticians query='team 51' field=team_group:");
  r = await call("context-a8c-execute-tool", {
    provider: "matticspace",
    tool: "search-automatticians",
    params: {
      query: "team 51",
      fields: ["team_group"],
      returned_fields: ["name", "wp_username", "job_title", "role", "role_type", "team_group"],
    },
  });
  console.log(JSON.stringify(r, null, 2));

  console.log("\n=== search-automatticians query='51' field=bio:");
  r = await call("context-a8c-execute-tool", {
    provider: "matticspace",
    tool: "search-automatticians",
    params: {
      query: "team 51",
      fields: ["bio"],
      returned_fields: ["name", "wp_username", "job_title", "role", "role_type", "team_group"],
    },
  });
  console.log(JSON.stringify(r, null, 2));

  proc.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  proc.kill();
  process.exit(1);
});
