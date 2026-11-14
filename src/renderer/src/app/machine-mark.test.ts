// The link's phase (the UX wave, U9, M3; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §7):
// O-39's table from the roster's fields, its words, and the mark that greys and says "offline" only in the offline and
// removed phases, turning a reconnecting machine offline by one timer at the minute's end.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MachineState } from '@shared/ipc/schema/machines';
import { REMOTE_ACT_PENDING_MS } from '@shared/machine/remote-pending';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { selectOffline, useMachines } from '../stores/machines';
import { machineChipText, phaseOf, phaseWords, selectShownOffline, useLinkPhase, useMachineMark } from './machine-mark';

const NOW = Date.parse('2026-11-13T09:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const studio = (over: Partial<MachineState>): MachineState => ({ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: ago(0), generation: 1, ...over });
const here: MachineState = { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: ago(3_600_000), generation: 0 };
const roster = (...machines: MachineState[]) => act(() => useMachines.getState().applyRoster([here, ...machines]));

beforeEach(() => useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() }));
afterEach(() => vi.useRealTimers());

describe('phaseOf: O-39’s table in roster terms', () => {
  it('reads each row of the table from the roster’s state, generation, since and refusal', () => {
    const rows: [string, MachineState | undefined, ReturnType<typeof phaseOf>][] = [
      ['a machine the roster does not name', undefined, 'up'],
      ['up', studio({ state: 'up' }), 'up'],
      ['connecting, its first attempt not answered', studio({ state: 'connecting', generation: 0 }), 'connecting'],
      ['down, up earlier in this run, for under a minute', studio({ state: 'down', since: ago(REMOTE_ACT_PENDING_MS - 1) }), 'reconnecting'],
      ['down, up earlier in this run, for a minute', studio({ state: 'down', since: ago(REMOTE_ACT_PENDING_MS) }), 'offline'],
      ['down, never up in this run (its first attempt failed)', studio({ state: 'down', generation: 0, since: ago(1_000) }), 'offline'],
      ['down, the machine removed this Mac', studio({ state: 'down', refusal: 'removed', since: ago(1_000) }), 'removed'],
    ];
    for (const [what, entry, phase] of rows) expect(phaseOf(entry, NOW), what).toBe(phase);
  });

  it('words each phase as O-39 does, and none for up', () => {
    expect(phaseWords('up', 'Studio')).toBeNull();
    expect(phaseWords('connecting', 'Studio')).toBe('Connecting to Studio…');
    expect(phaseWords('reconnecting', 'Studio')).toBe('Reconnecting to Studio…');
    expect(phaseWords('offline', 'Studio')).toBe('Studio is offline · this session reconnects when it’s back');
    expect(phaseWords('removed', 'Studio')).toBe('This Mac is no longer allowed on Studio');
  });
});

describe('the mark: greyed and "offline" only in the offline and removed phases', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));

  it('reads a connecting or reconnecting machine as not offline, with its @name chip, while selectOffline keeps “not up”', () => {
    for (const entry of [studio({ state: 'connecting', generation: 0 }), studio({ state: 'down', since: ago(5_000) })]) {
      roster(entry);
      const { result, unmount } = renderHook(() => useMachineMark(`${OTHER_MACHINE}/app-1`));
      expect(result.current.offline, entry.state).toBe(false);
      expect(machineChipText(result.current)).toBe('@Studio');
      expect(selectOffline(useMachines.getState(), OTHER_MACHINE), 'the link answer is unchanged').toBe(true);
      expect(selectShownOffline(useMachines.getState(), OTHER_MACHINE, NOW)).toBe(false);
      unmount();
    }
  });

  it('greys an offline machine’s and a removed one’s, and says “offline” in the chip’s place', () => {
    for (const [entry, phase] of [[studio({ state: 'down', generation: 0 }), 'offline'], [studio({ state: 'down', refusal: 'removed' }), 'removed']] as const) {
      roster(entry);
      const { result, unmount } = renderHook(() => useMachineMark(`${OTHER_MACHINE}/app-1`));
      expect(result.current.phase).toBe(phase);
      expect(result.current.offline).toBe(true);
      expect(machineChipText(result.current)).toBe('offline');
      expect(selectShownOffline(useMachines.getState(), OTHER_MACHINE, NOW)).toBe(true);
      unmount();
    }
  });

  it('turns a reconnecting machine offline at since plus the minute, by one timer', () => {
    roster(studio({ state: 'down', since: ago(10_000) }));
    const { result, unmount } = renderHook(() => useLinkPhase(OTHER_MACHINE));
    expect(result.current).toBe('reconnecting');
    expect(vi.getTimerCount(), 'one timer, armed for the minute’s end').toBe(1);
    act(() => vi.advanceTimersByTime(REMOTE_ACT_PENDING_MS - 10_001));
    expect(result.current).toBe('reconnecting');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('offline');
    expect(vi.getTimerCount(), 'nothing left to wait for').toBe(0);
    unmount();
  });

  it('arms no timer while no machine reconnects, and one for a machine that goes down after a page has read the phase', () => {
    roster(studio({ state: 'up' }));
    const { result, unmount } = renderHook(() => useLinkPhase(OTHER_MACHINE));
    expect(result.current).toBe('up');
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5 * 60_000)); // a while later, the link drops: `since` is the drop
    roster(studio({ state: 'down', since: new Date(Date.now()).toISOString() }));
    expect(result.current).toBe('reconnecting');
    act(() => vi.advanceTimersByTime(REMOTE_ACT_PENDING_MS));
    expect(result.current).toBe('offline');
    roster(studio({ state: 'up', generation: 2 }));
    expect(result.current).toBe('up');
    unmount();
  });

  it('reads this Mac as up', () => {
    roster();
    const { result } = renderHook(() => useMachineMark(`${TEST_MACHINE}/app-1`));
    expect(result.current).toMatchObject({ local: true, phase: 'up', offline: false });
  });
});
