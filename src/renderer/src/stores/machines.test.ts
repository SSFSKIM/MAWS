import { describe, expect, it } from 'vitest';
import type { MachineState } from '@shared/ipc/schema/machines';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { createMachinesStore, selectOffline } from './machines';

const entry = (ref: MachineState['ref'], state: MachineState['state'], generation = 1): MachineState => ({ ref, name: ref, local: ref === TEST_MACHINE, state, since: '2026-10-27T10:00:00Z', generation });

describe('the machines store (P5 O6 M4)', () => {
  it('holds the roster as the last whole list, and calls a listed machine whose link is not up offline', () => {
    const store = createMachinesStore();
    expect(store.getState().roster).toBe('unread');
    store.getState().applyRoster([entry(TEST_MACHINE, 'up'), entry(OTHER_MACHINE, 'connecting', 0)]);
    expect(store.getState().roster).toBe('answered');
    expect(selectOffline(store.getState(), TEST_MACHINE)).toBe(false);
    expect(selectOffline(store.getState(), OTHER_MACHINE)).toBe(true);
    store.getState().applyRoster([entry(TEST_MACHINE, 'up')]);
    expect([...store.getState().machines.keys()]).toEqual([TEST_MACHINE]);
    expect(selectOffline(store.getState(), OTHER_MACHINE)).toBe(false); // a machine the roster does not name is not said to be
  });

  it('records a failed read only while the roster is unread', () => {
    const failed = createMachinesStore();
    failed.getState().rosterFailed();
    expect(failed.getState().roster).toBe('failed');
    failed.getState().applyRoster([entry(TEST_MACHINE, 'up')]);
    expect(failed.getState().roster).toBe('answered');
    failed.getState().rosterFailed();
    expect(failed.getState().roster).toBe('answered');
  });

  it('keeps a machine loaded whatever the roster says next', () => {
    const store = createMachinesStore();
    store.getState().setLoaded(OTHER_MACHINE);
    store.getState().applyRoster([entry(TEST_MACHINE, 'up'), entry(OTHER_MACHINE, 'up')]);
    const loaded = store.getState().loaded;
    store.getState().setLoaded(OTHER_MACHINE);
    expect(store.getState().loaded).toBe(loaded); // no write for a machine already loaded
    store.getState().applyRoster([entry(TEST_MACHINE, 'up'), entry(OTHER_MACHINE, 'down')]);
    expect(store.getState().loaded.has(OTHER_MACHINE)).toBe(true);
  });
});
