// Probe matticspace.list-group-members for team-51.
//   node --import tsx/esm packages/mcp-client/scripts/probe-team-51-roster.mjs

import { spawn } from "node:child_process";

const proc = spawn("npx", ["-y", "@automattic/mcp-context-a8c"], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
let id = 0;

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
      if (msg.result?.content?.[0]?.text) {
        try {
          const parsed = JSON.parse(msg.result.content[0].text);
          console.log("=== parsed result:");
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log("=== raw:", msg.result.content[0].text);
        }
      }
    } catch {
      console.log(line);
    }
  }
});

setTimeout(() => {
  send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "probe", version: "0.0.1" },
  });
}, 200);
setTimeout(() => send("notifications/initialized", {}), 700);
setTimeout(() => {
  send("tools/call", {
    name: "context-a8c-execute-tool",
    arguments: {
      provider: "matticspace",
      tool: "list-group-members",
      params: {
        group: "team-51",
        include_subteams: true,
        returned_fields: ["name", "wp_username", "job_title", "team_group", "is_team_lead", "matticspace_url"],
      },
    },
  });
}, 1500);
setTimeout(() => {
  proc.kill();
  process.exit(0);
}, 15000);
