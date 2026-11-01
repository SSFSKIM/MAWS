// The e2e's race of a call into a handover (P5 O16 M3c fix wave 2, docs/doperpowers/plans/2026-10-31-p5-o16-holder.md,
// D63: case (f)'s short deferral by an update). An update asks `host.handover` at the engine host's first quiet report,
// so a call that starts between that report and the freeze defers the handover; a scene cannot time one there. Under
// `MAWS_E2E=1` with `MAWS_E2E_HANDOVER_RACE=1`, both ends are held in the engine host: a `maws` call of any tool but `ask`
// the engine sends waits, before it is dispatched (so before it counts in flight), until the first `host.handover` is
// asked (`gate`, the tool server's); and that ask waits, before it freezes, until a call is in flight (`race`, read every
// 100 ms, at most HANDOVER_RACE_MAX_MS; supervision.ts counts the wait in the ask's grace). So the call starts between
// the quiet report and the freeze, and is in flight at the freeze. Outside MAWS_E2E there is neither.
import { setTimeout as sleep } from 'node:timers/promises';

export const HANDOVER_RACE_MAX_MS = 60_000;
const RACE_POLL_MS = 100;

export interface HandoverRaceDeps {
  sleep(ms: number): Promise<unknown>;
  now(): number;
}

const SYSTEM: HandoverRaceDeps = { sleep: (ms) => sleep(ms), now: () => Date.now() };

// Resolves with how long it waited; at once when `over` (another ask armed the drain meanwhile).
export type HandoverRace = (inFlight: () => number, over?: () => boolean) => Promise<number>;

export interface HandoverRaceSeam {
  race: HandoverRace;
  gate: () => Promise<void>; // settles once the first race began (a handover was asked)
}

export function handoverRaceFor(env: NodeJS.ProcessEnv, deps: HandoverRaceDeps = SYSTEM): HandoverRaceSeam | undefined {
  if (env.MAWS_E2E !== '1' || env.MAWS_E2E_HANDOVER_RACE !== '1') return undefined;
  let asked: () => void = () => {};
  const handoverAsked = new Promise<void>((resolve) => (asked = resolve));
  return {
    gate: () => handoverAsked,
    race: async (inFlight, over = () => false) => {
      asked();
      const from = deps.now();
      while (inFlight() === 0 && !over() && deps.now() - from < HANDOVER_RACE_MAX_MS) await deps.sleep(RACE_POLL_MS);
      return deps.now() - from;
    },
  };
}

// The engine host's own, one per process: its sessions' tool servers take `gate`, its supervision `race`
export const E2E_HANDOVER_RACE = handoverRaceFor(process.env);
