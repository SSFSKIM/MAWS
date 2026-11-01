// The e2e's race into a deferred handover (./e2e-handover-race.ts): off outside MAWS_E2E or unasked; on, the freeze
// waits until a call is in flight, bounded, and says how long it waited.
import { describe, expect, it } from 'vitest';
import { HANDOVER_RACE_MAX_MS, handoverRaceFor } from './e2e-handover-race';

function harness(inFlight: number[]) {
  const calls: string[] = [];
  let now = 0;
  const deps = {
    sleep: async (ms: number) => {
      calls.push(`sleep ${ms}`);
      now += ms;
    },
    now: () => now,
  };
  const count = () => {
    const n = inFlight.shift() ?? 0;
    calls.push(`inFlight ${n}`);
    return n;
  };
  return { calls, deps, count };
}

describe('handoverRaceFor: the e2e race of a call into a handover', () => {
  it('is no race outside MAWS_E2E or unasked', () => {
    const { deps } = harness([]);
    expect(handoverRaceFor({ MAWS_E2E_HANDOVER_RACE: '1' }, deps)).toBeUndefined();
    expect(handoverRaceFor({ MAWS_E2E: '1' }, deps)).toBeUndefined();
    expect(handoverRaceFor({ MAWS_E2E: '1', MAWS_E2E_HANDOVER_RACE: '0' }, deps)).toBeUndefined();
  });

  it('settles once a call is in flight, with how long it waited', async () => {
    const { calls, deps, count } = harness([0, 0, 1]);
    expect(await handoverRaceFor({ MAWS_E2E: '1', MAWS_E2E_HANDOVER_RACE: '1' }, deps)!(count)).toBe(200);
    expect(calls).toEqual(['inFlight 0', 'sleep 100', 'inFlight 0', 'sleep 100', 'inFlight 1']);
  });

  it('ends at once when another ask armed the drain meanwhile, so its own answer never holds the exit', async () => {
    const { deps, count } = harness([0, 0, 0, 0]);
    let asked = 0;
    const race = handoverRaceFor({ MAWS_E2E: '1', MAWS_E2E_HANDOVER_RACE: '1' }, deps)!(count, () => ++asked > 1); // armed after the first poll
    expect(await race).toBe(100);
  });

  it('gives up at its bound, so a scene that never calls cannot hold a handover for good', async () => {
    const { deps, count } = harness([]);
    expect(await handoverRaceFor({ MAWS_E2E: '1', MAWS_E2E_HANDOVER_RACE: '1' }, deps)!(count)).toBe(HANDOVER_RACE_MAX_MS);
  });
});
