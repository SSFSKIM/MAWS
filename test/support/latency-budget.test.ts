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

  // ci-kit's mac-lane concurrency spec, the VM lane (V3): its macOS guest runs a job at 1.3-1.7x the host's time.
  it('holds five times the bound in a VM guest, however quiet the load read, and reads the flag from the environment', () => {
    expect(budgetVerdict('git.changed after the stage', 12.5, 150, { load: 1.2, cores: 4, guest: true })).toEqual({
      ceiling: 750,
      reason: 'git.changed after the stage: 12.5 ms against 150 ms, held to 750 ms in a VM guest (CI_KIT_VM_GUEST=1), at load 1.2 on 4 cores',
    });
    expect(budgetVerdict('coldAttachMs', 3_200, 3_000, { load: 0.5, cores: 4, guest: false })).toEqual({ ceiling: 3_000, reason: null });
    expect(machineLoad({ CI_KIT_VM_GUEST: '1' }).guest).toBe(true);
    for (const env of [{}, { CI_KIT_VM_GUEST: '0' }, { CI_KIT_VM_GUEST: '' }, { CI_KIT_SHARED_DESKTOP: '1' }]) expect(machineLoad(env).guest, JSON.stringify(env)).toBe(false);
  });

  // A host where that guest may boot beside the job after the load was read: every budgeted bound is held to its ceiling.
  it('holds five times the bound on a host with ci-kit\'s VM lane, however quiet the load read, and reads the flag from the environment', () => {
    expect(budgetVerdict('scm refresh', 120, 150, { load: 0.8, cores: 10, lane: true })).toEqual({
      ceiling: 750,
      reason: 'scm refresh: 120 ms against 150 ms, held to 750 ms beside ci-kit\'s VM lane (CI_KIT_VM_LANE=1), at load 0.8 on 10 cores',
    });
    expect(machineLoad({ CI_KIT_VM_LANE: '1' }).lane).toBe(true);
    for (const env of [{}, { CI_KIT_VM_LANE: '0' }, { CI_KIT_VM_GUEST: '1' }]) expect(machineLoad(env).lane, JSON.stringify(env)).toBe(false);
  });
});
