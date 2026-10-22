import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { budgetVerdict, LOADED_CEILING, machineLoad, QUIET_LOAD_PER_CORE } from './latency-budget';

describe('a latency bound is asserted as named only on a quiet machine', () => {
  // Never consult the runner's real reservation, including in the original load/shared/guest cases.
  beforeEach(() => vi.stubEnv('CI_KIT_VM_RESERVATION', undefined));
  afterEach(() => vi.unstubAllEnvs());

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

  describe('a guest beside the test is read at the verdict, not when the load was read', () => {
    const started = 1_700_000_000_750;
    const quiet = { load: 0.8, cores: 10 };
    let directory: string;
    let reservation: string;
    let released: string;
    const verdict = (env: Record<string, string | undefined> = { CI_KIT_VM_RESERVATION: reservation }) =>
      budgetVerdict('scm refresh', 200, 150, quiet, started, env);

    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), 'maws-vm-budget-'));
      reservation = join(directory, 'vm-reserved');
      released = join(directory, 'vm-released');
    });
    afterEach(() => rmSync(directory, { recursive: true, force: true }));

    it('loosens for a reservation created after the start and still present at the verdict', () => {
      expect(verdict()).toEqual({ ceiling: 150, reason: null });
      writeFileSync(reservation, '');
      expect(verdict()).toEqual({
        ceiling: 750,
        reason: 'scm refresh: 200 ms against 150 ms, held to 750 ms beside a guest reserved now, at load 0.8 on 10 cores',
      });
    });

    it.each([1_700_000_000, 1_700_000_002])('loosens for a release at or after the start second (%s), even after the reservation is gone', (epoch) => {
      writeFileSync(reservation, '');
      writeFileSync(released, `${epoch}\n`);
      rmSync(reservation);
      expect(verdict()).toEqual({
        ceiling: 750,
        reason: 'scm refresh: 200 ms against 150 ms, held to 750 ms beside a guest released since the test started, at load 0.8 on 10 cores',
      });
    });

    it('holds the tight bound for a release before the test started', () => {
      writeFileSync(released, '1699999999\n');
      expect(verdict()).toEqual({ ceiling: 150, reason: null });
    });

    it('ignores the lane when the variable is unset', () => {
      writeFileSync(reservation, '');
      writeFileSync(released, '1700000002\n');
      expect(verdict({})).toEqual({ ceiling: 150, reason: null });
    });

    it('holds the tight bound with a configured lane but no reservation or release', () => {
      expect(verdict()).toEqual({ ceiling: 150, reason: null });
    });

    it.each(['', 'not an epoch', '1700000002junk', '1700000002\n1700000003', '1700000002\n\n', 'Infinity', '1.7e9', '+1700000002', '-1', ' 1700000002 ', '9007199254740992'])('treats a malformed release as loaded (%j)', (contents) => {
      writeFileSync(released, contents);
      expect(verdict().ceiling).toBe(750);
      expect(verdict().reason).toContain('guest release malformed');
    });

    it('treats a reservation path that cannot be read as loaded', () => {
      // ELOOP is unreadable even for a privileged test runner, unlike chmod(0).
      symlinkSync(reservation, reservation);
      expect(verdict().ceiling).toBe(750);
      expect(verdict().reason).toContain('guest reservation unreadable');
    });

    it('treats a release path that cannot be read as loaded, rather than missing', () => {
      mkdirSync(released); // readFileSync raises EISDIR on both gate platforms.
      expect(verdict().ceiling).toBe(750);
      expect(verdict().reason).toContain('guest release unreadable');
    });
  });
});
