// Whether a session compacts (UX wave U3b, M4; the execution document's M4 table of transitions, Interfaces §E): the
// engine's status for a session MAWS runs, a terminal session's bridge `compact` messages, and what ends each.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { status } from '../../../../test/support/builders';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import type { Row, RowId, TurnId } from '../transcript/model/rows';
import { clearCompacting, connectCompacting, noteCompacting, useCompacting } from './compacting';
import { applyLaneAState, resetLaneAStore } from './lane-a';
import { useSessions } from './sessions';
import { useTranscriptStore } from './transcript';

const A = at('app-compacting-a') as AppSessionId;
const B = at('app-compacting-b') as AppSessionId;
const since = (id: AppSessionId) => useCompacting.getState().held.get(id)?.since ?? null;
const T0 = Date.parse('2026-11-15T10:00:00.000Z');
const engine = (id: AppSessionId, over: Partial<EngineSessionStatus> = {}): EngineSessionStatus => ({ ...status(id), ...over });
const apply = (s: EngineSessionStatus) => useSessions.getState().applyStatus({ appSessionId: s.appSessionId, status: s }, TEST_MACHINE);

let disconnect: () => void = () => {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  useCompacting.setState({ held: new Map() });
  useSessions.setState({ engine: new Map() });
  resetLaneAStore();
});
afterEach(() => {
  disconnect();
  disconnect = () => {};
  vi.useRealTimers();
});

describe('a session MAWS runs: its engine status', () => {
  beforeEach(() => {
    disconnect = connectCompacting();
  });

  it('turns on at a `compacting` status of a ready process, and the engine’s repeat keeps the first time', () => {
    apply(engine(A, { activity: 'requesting' }));
    expect(since(A)).toBeNull();
    apply(engine(A, { activity: 'compacting' }));
    expect(since(A)).toBe(T0);
    vi.setSystemTime(T0 + 30_000);
    apply(engine(A, { activity: 'compacting' })); // the engine says it again thirty seconds on
    expect(since(A)).toBe(T0);
  });

  it.each([
    ['a status with no activity', { activity: null }],
    ['a status with another activity', { activity: 'requesting' }],
    ['a process that is exiting', { activity: 'compacting', process: 'exiting' }],
    ['a process that exited', { activity: 'compacting', process: 'exited' }],
  ] as const)('turns off at %s', (_, over) => {
    apply(engine(A, { activity: 'compacting' }));
    apply(engine(A, over));
    expect(since(A)).toBeNull();
  });

  it('turns off when the session’s status is removed, and leaves other sessions as they are', () => {
    apply(engine(A, { activity: 'compacting' }));
    apply(engine(B, { activity: 'compacting' }));
    useSessions.getState().forgetStatuses(TEST_MACHINE, (id) => id === B);
    expect(since(A)).toBeNull();
    expect(since(B)).toBe(T0);
  });

  it('is not on for a process that is not ready yet', () => {
    apply(engine(A, { activity: 'compacting', process: 'initializing' }));
    expect(since(A)).toBeNull();
  });

  it('reads the statuses already held when it connects', () => {
    disconnect();
    apply(engine(A, { activity: 'compacting' }));
    disconnect = connectCompacting();
    expect(since(A)).toBe(T0);
  });
});

describe('a terminal session: its bridge’s `compact` messages', () => {
  const R = 'rpc-one';
  const bridge = (rpc: string) => ({ kind: 'bridge', rpc }) as const;

  it('turns on at `start` and off at the same operation’s `end`, never at another’s', () => {
    noteCompacting(A, bridge(R), true);
    expect(since(A)).toBe(T0);
    noteCompacting(A, bridge('rpc-other'), false);
    expect(since(A)).toBe(T0);
    noteCompacting(A, bridge(R), false);
    expect(since(A)).toBeNull();
  });

  it('a second `start` while one runs keeps the first time and holds it by the newer operation', () => {
    noteCompacting(A, bridge(R), true);
    vi.setSystemTime(T0 + 4_000);
    noteCompacting(A, bridge('rpc-two'), true);
    expect(since(A)).toBe(T0);
    noteCompacting(A, bridge(R), false);
    expect(since(A)).toBe(T0);
    noteCompacting(A, bridge('rpc-two'), false);
    expect(since(A)).toBeNull();
  });

  it('turns off when its watch resets or ends (clearCompacting)', () => {
    noteCompacting(A, bridge(R), true);
    clearCompacting(A);
    expect(since(A)).toBeNull();
  });

  it('is never turned off by the engine statuses, which a terminal session has none of', () => {
    disconnect = connectCompacting();
    noteCompacting(A, bridge(R), true);
    apply(engine(B, { activity: null }));
    useSessions.getState().forgetStatuses(TEST_MACHINE);
    expect(since(A)).toBe(T0);
  });

  it('turns off when its bridge is no longer live, or its state goes', () => {
    disconnect = connectCompacting();
    applyLaneAState(A, laneAState(A));
    applyLaneAState(B, laneAState(B));
    noteCompacting(A, bridge(R), true);
    noteCompacting(B, bridge(R), true);
    applyLaneAState(A, laneAState(A, { bridge: 'observer' }));
    expect(since(A)).toBeNull();
    expect(since(B)).toBe(T0);
    applyLaneAState(B, null);
    expect(since(B)).toBeNull();
  });

  it('turns off when a compaction’s boundary later than its start reaches the transcript, not one from before', () => {
    disconnect = connectCompacting();
    noteCompacting(A, bridge(R), true);
    const boundary = (atMs: number): Row => ({ id: `boundary:${atMs}` as RowId, turnId: null as TurnId | null, at: new Date(atMs).toISOString(), kind: 'boundary', boundaryKind: 'compaction', text: 'Context compacted', detail: null, hiddenRows: 0, revealed: false });
    const withRows = (rows: Row[]) => useTranscriptStore.setState((state) => ({ entries: { ...state.entries, [A]: { ...state.entries[A], rows } as (typeof state.entries)[string] } }));
    withRows([boundary(T0 - 60_000)]); // an earlier compaction's
    expect(since(A)).toBe(T0);
    withRows([boundary(T0 - 60_000), boundary(T0 + 5_000)]);
    expect(since(A)).toBeNull();
  });
});
