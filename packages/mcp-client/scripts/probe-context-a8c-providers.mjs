// Probe ContextA8C MCP to see what providers + tools it exposes.
// Run from the repo root:
//   node --import tsx/esm packages/mcp-client/scripts/probe-context-a8c-providers.mjs

import { spawn } from "node:child_process";

const proc = spawn("npx", ["-y", "@automattic/mcp-context-a8c"], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
let id = 0;

function send(method, params) {
  id += 1;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  proc.stdin.write(`${msg}\n`);
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
      if (msg.result) console.log(JSON.stringify(msg.result, null, 2));
      else console.log(line);
    } catch {
      console.log("(non-JSON)", line);
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
setTimeout(() => send("tools/list", {}), 900);
setTimeout(() => {
  console.log("\n=== trying context-a8c-load-provider for matticspace:");
  send("tools/call", {
    name: "context-a8c-load-provider",
    arguments: { provider: "matticspace" },
  });
}, 1500);
setTimeout(() => {
  console.log("\n=== trying provider=wpcom:");
  send("tools/call", {
    name: "context-a8c-load-provider",
    arguments: { provider: "wpcom" },
  });
}, 2500);
setTimeout(() => {
  proc.kill();
  process.exit(0);
}, 6000);
