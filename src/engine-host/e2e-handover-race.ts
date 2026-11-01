// The e2e's race of a call into a handover (P5 O16 M3c fix wave 2, docs/doperpowers/plans/2026-10-31-p5-o16-holder.md,
// D63: case (f)'s short deferral by an update). An update asks `host.handover` at the engine host's first quiet report,
// so a call that starts between that report and the freeze defers the handover; a scene cannot time one there. Under
// `MAWS_E2E=1` with `MAWS_E2E_HANDOVER_RACE=1`, the first `host.handover` waits, before it freezes, until a call is in
// flight (read every 100 ms, at most HANDOVER_RACE_MAX_MS), so the scene starts one then. Outside MAWS_E2E there is no
// race. The supervision applies it (supervision.ts `e2eRace`) and counts the wait in the ask's grace.
import { setTimeout as sleep } from 'node:timers/promises';

export const HANDOVER_RACE_MAX_MS = 60_000;
const RACE_POLL_MS = 100;

export interface HandoverRaceDeps {
  sleep(ms: number): Promise<unknown>;
  now(): number;
}

const SYSTEM: HandoverRaceDeps = { sleep: (ms) => sleep(ms), now: () => Date.now() };

// Resolves with how long it waited.
export type HandoverRace = (inFlight: () => number) => Promise<number>;

export function handoverRaceFor(env: NodeJS.ProcessEnv, deps: HandoverRaceDeps = SYSTEM): HandoverRace | undefined {
  if (env.MAWS_E2E !== '1' || env.MAWS_E2E_HANDOVER_RACE !== '1') return undefined;
  return async (inFlight) => {
    const from = deps.now();
    while (inFlight() === 0 && deps.now() - from < HANDOVER_RACE_MAX_MS) await deps.sleep(RACE_POLL_MS);
    return deps.now() - from;
  };
}
