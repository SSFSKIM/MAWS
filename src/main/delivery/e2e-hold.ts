// The e2e's hold on Send to's export phase (P5 O4 M2, docs/doperpowers/plans/2026-10-31-p5-o4-services.md, acceptance 5
// and D15, D29: a cancel during the export sends nothing and removes the export's file). Under `MAWS_E2E=1` with
// `MAWS_E2E_DELIVERY_HOLD` naming a file, main's `delivery.send` gets its export's answer only once that file is gone
// (read every 100 ms, at most HOLD_MAX_MS): the export has been written, so a scene (e2e/delivery.spec.ts) cancels inside
// the export phase with the export's file on disk, then lifts the hold. Outside MAWS_E2E, or with no file named, the
// export is returned untouched.
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

export const HOLD_MAX_MS = 120_000;
const HOLD_POLL_MS = 100;

export interface HoldDeps {
  exists(path: string): boolean;
  sleep(ms: number): Promise<unknown>;
  now(): number;
}

const SYSTEM: HoldDeps = { exists: existsSync, sleep: (ms) => sleep(ms), now: () => Date.now() };

export function exportHeldFor<A extends unknown[], R>(exportArtifact: (...args: A) => Promise<R>, env: NodeJS.ProcessEnv, deps: HoldDeps = SYSTEM): (...args: A) => Promise<R> {
  const hold = env.MAWS_E2E === '1' ? env.MAWS_E2E_DELIVERY_HOLD : undefined;
  if (!hold) return exportArtifact;
  return async (...args) => {
    const exported = await exportArtifact(...args);
    const until = deps.now() + HOLD_MAX_MS;
    while (deps.exists(hold) && deps.now() < until) await deps.sleep(HOLD_POLL_MS);
    return exported;
  };
}
