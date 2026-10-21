import { describe, expect, it } from 'vitest';
import { budgetVerdict, LOADED_CEILING, machineLoad, QUIET_LOAD_PER_CORE } from './latency-budget';

describe('a latency bound is asserted as named only on a quiet machine', () => {
  it('holds the bound under one runnable thread per core, and five times it with the reason at or past it', () => {
    expect(QUIET_LOAD_PER_CORE).toBe(1);
    expect(LOADED_CEILING).toBe(5);
    expect(budgetVerdict('coldAttachMs', 3_200, 3_000, { load: 9.9, cores: 10 })).toEqual({ ceiling: 3_000, reason: null });
    expect(budgetVerdict('coldAttachMs', 3_200, 3_000, { load: 74.26, cores: 10 })).toEqual({
      ceiling: 15_000,
      reason: 'coldAttachMs: 3200 ms against 3000 ms, held to 15000 ms at load 74.3 on 10 cores',
    });
    expect(budgetVerdict('pingMaxMs', 20, 100, { load: 10, cores: 10 }).ceiling).toBe(500); // loaded even when met
  });

  // ci-kit's mac-lane concurrency spec, M2: a neighbour may start its build after the test read the load.
  it('holds five times the bound on a shared desktop, however quiet the load read, and reads the flag from the environment', () => {
    expect(budgetVerdict('git.changed after the stage', 12.5, 150, { load: 1.2, cores: 10, shared: true })).toEqual({
      ceiling: 750,
      reason: 'git.changed after the stage: 12.5 ms against 150 ms, held to 750 ms on a shared desktop (CI_KIT_SHARED_DESKTOP=1), at load 1.2 on 10 cores',
    });
    expect(budgetVerdict('coldAttachMs', 3_200, 3_000, { load: 74.26, cores: 10, shared: true }).ceiling).toBe(15_000);
    expect(budgetVerdict('coldAttachMs', 3_200, 3_000, { load: 9.9, cores: 10, shared: false })).toEqual({ ceiling: 3_000, reason: null });
    expect(machineLoad({ CI_KIT_SHARED_DESKTOP: '1' }).shared).toBe(true);
    for (const env of [{}, { CI_KIT_SHARED_DESKTOP: '0' }, { CI_KIT_SHARED_DESKTOP: '' }]) expect(machineLoad(env).shared, JSON.stringify(env)).toBe(false);
  });
});
