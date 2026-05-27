/**
 * Next.js instrumentation entry — runs once per server process at startup.
 *
 * This file is compiled for BOTH the Node and Edge runtimes. Anything
 * that touches `node:*` modules must live in `instrumentation-node.ts`
 * and be dynamically imported only when NEXT_RUNTIME === "nodejs", or
 * webpack will try to bundle the node-only imports for the Edge build
 * and blow up with UnhandledSchemeError.
 */

export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    await import("./instrumentation-node");
  }
}
