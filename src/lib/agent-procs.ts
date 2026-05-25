// Process-global map of in-flight agent subprocesses, keyed by agent name.
// Survives across Next.js request handlers within the same Node process.

import type { ChildProcess } from "node:child_process";

declare global {
  // eslint-disable-next-line no-var
  var __bfi_agent_procs: Map<string, ChildProcess> | undefined;
}

export function agentProcs(): Map<string, ChildProcess> {
  if (!globalThis.__bfi_agent_procs) {
    globalThis.__bfi_agent_procs = new Map();
  }
  return globalThis.__bfi_agent_procs;
}
