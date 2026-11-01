// The e2e's hold on a `maws` tool call (P5 O16 M3c, docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3: case (f)'s
// deferred handover). Under `MAWS_E2E=1` with `MAWS_E2E_TOOL_HOLD` naming a file, a call of any tool but `ask` waits,
// before its tool runs, until that file is gone (read every 100 ms, at most TOOL_HOLD_MAX_MS): the call is in flight
// across an engine-host update, so the handover defers, and the scene lifts the hold to let the drain settle. Outside
// MAWS_E2E, or with no file named, there is no hold. The tool server applies it (./server.ts `hold`).
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

export const TOOL_HOLD_MAX_MS = 120_000;
const HOLD_POLL_MS = 100;

export interface ToolHoldDeps {
  exists(path: string): boolean;
  sleep(ms: number): Promise<unknown>;
  now(): number;
}

const SYSTEM: ToolHoldDeps = { exists: existsSync, sleep: (ms) => sleep(ms), now: () => Date.now() };

export function toolHoldFor(env: NodeJS.ProcessEnv, deps: ToolHoldDeps = SYSTEM): (() => Promise<void>) | undefined {
  const hold = env.MAWS_E2E === '1' ? env.MAWS_E2E_TOOL_HOLD : undefined;
  if (!hold) return undefined;
  return async () => {
    const until = deps.now() + TOOL_HOLD_MAX_MS;
    while (deps.exists(hold) && deps.now() < until) await deps.sleep(HOLD_POLL_MS);
  };
}
