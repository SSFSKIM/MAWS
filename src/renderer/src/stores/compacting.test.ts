// Whether a session compacts (UX wave U3b, M4; the execution document's M4 table of transitions, Interfaces §E): the
// engine's status for a session MAWS runs, a terminal session's bridge `compact` messages, and what ends each.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { status } from '../../../../test/support/builders';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import type { SessionEvent } from '@shared/graph/events';
import type { Row, RowId, TurnId } from '../transcript/model/rows';
import { builder, type Builder } from '../transcript/model/test-events';
import type { TranscriptSource } from '../transcript/source/types';
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

  // the review of M4 (the corrected table): `starting` is a passing state that keeps it; going away or to anything but
  // `live` or `starting` ends it, from `starting` as from `live`
  it('stays on while the bridge reads `starting`, and turns off when that state goes', () => {
    disconnect = connectCompacting();
    applyLaneAState(A, laneAState(A, { bridge: 'starting', reason: 'starting' }));
    noteCompacting(A, bridge(R), true);
    applyLaneAState(A, laneAState(A, { bridge: 'starting', reason: 'still starting' }));
    expect(since(A)).toBe(T0);
    applyLaneAState(A, null);
    expect(since(A)).toBeNull();
  });

  it('turns off when a `starting` bridge becomes unavailable', () => {
    disconnect = connectCompacting();
    applyLaneAState(A, laneAState(A, { bridge: 'starting', reason: 'starting' }));
    noteCompacting(A, bridge(R), true);
    applyLaneAState(A, laneAState(A, { bridge: 'none', reason: 'the bridge is gone' }));
    expect(since(A)).toBeNull();
  });

  // M4's re-review (the corrected table): what a compaction started over is told by the transcript's own lifecycle, through
  // the store's real attach. Every change while the key hydrates (the attach's snapshot, a rebuild when an older page
  // joins) takes the session's boundaries as known; a boundary ends it only in a live batch, as the newest compaction
  // boundary in drawn order, with an id not known. The lane A plane's pager reaches the store the same way: an older
  // page rebuilds its rows under a new source (`PlaneTranscript.rebuild`), which the view attaches, so the key hydrates.
  describe('a compaction’s boundary over the transcript’s lifecycle', () => {
    let keys = 0;
    let C = at('app-compacting-lifecycle-0') as AppSessionId; // a key of its own per case: a detached key is kept, rows and all
    const compaction = (b: Builder, id: string) => b.emit('boundary.compaction', { trigger: 'manual', preTokens: 90_000, postTokens: 12_000, logicalParentUuid: null, historical: false }, { id });
    const answered = (b: Builder, n: string) => {
      b.turn(`u-${n}`, `Check gauge ${n}.`);
      b.text(`m-${n}`, 0, `Gauge ${n} reads fine.`);
      b.end([`u-${n}`]);
    };
    /** A source whose every snapshot waits for the test, and which can ask the store for a rebuild. */
    function attached() {
      const snapshots: ((events: SessionEvent[]) => void)[] = [];
      let push: (batch: SessionEvent[]) => void = () => {};
      let rebuild: () => void = () => {};
      const source: TranscriptSource = {
        key: C,
        subscribe: (listener) => ((push = listener), () => {}),
        snapshot: () => new Promise<SessionEvent[]>((resolve) => void snapshots.push(resolve)),
        onRebuild: (listener) => ((rebuild = listener), () => {}),
      };
      const settled = useTranscriptStore.getState().attach(C, source);
      return { settled, give: (events: SessionEvent[]) => snapshots.shift()!(events), push: (events: SessionEvent[]) => push(events), rebuild: () => rebuild() };
    }
    const compactions = () => useTranscriptStore.getState().entries[C]!.rows.filter((row) => row.kind === 'boundary' && row.boundaryKind === 'compaction').length;
    beforeEach(() => {
      C = at(`app-compacting-lifecycle-${++keys}`) as AppSessionId;
      disconnect = connectCompacting();
    });
    afterEach(() => useTranscriptStore.getState().detach(C));

    it('on before the history arrives, then a snapshot holding older boundaries: it stays on', async () => {
      const source = attached();
      noteCompacting(C, bridge(R), true);
      const b = builder();
      answered(b, '1');
      compaction(b, 'old-1');
      answered(b, '2');
      compaction(b, 'old-2');
      source.give([...b.events]);
      await source.settled;
      expect(compactions()).toBe(2);
      expect(since(C)).toBe(T0);
      const from = b.events.length;
      answered(b, '3'); // a live batch with no boundary
      source.push(b.events.slice(from));
      expect(since(C)).toBe(T0);
    });

    it('an older page joining while it compacts rebuilds the key: its boundary is history, and it stays on', async () => {
      const source = attached();
      const b = builder();
      answered(b, '2');
      source.give([...b.events]);
      await source.settled;
      noteCompacting(C, bridge(R), true);
      const older = builder('2026-09-27T10:00:00.000Z');
      answered(older, 'older-1');
      compaction(older, 'older-boundary');
      source.rebuild();
      source.give([...older.events.map((event) => ({ ...event, id: `older-${event.id}` }) as SessionEvent), ...b.events]);
      await waitForPhase('live');
      expect(compactions()).toBe(1);
      expect(since(C)).toBe(T0);
    });

    it('a live batch whose new boundary is the newest turns it off', async () => {
      const source = attached();
      const b = builder();
      answered(b, '1');
      compaction(b, 'old-1');
      source.give([...b.events]);
      await source.settled;
      noteCompacting(C, bridge(R), true);
      const from = b.events.length;
      compaction(b, 'completing');
      source.push(b.events.slice(from));
      expect(since(C)).toBeNull();
    });

    it('accepted residue: a completing boundary inside the first snapshot is taken as history, and it stays on (until the bridge’s end, the watch or the bridge ends it)', async () => {
      const source = attached();
      noteCompacting(C, bridge(R), true);
      const b = builder();
      answered(b, '1');
      compaction(b, 'completing');
      source.give([...b.events]);
      await source.settled;
      expect(compactions()).toBe(1);
      expect(since(C)).toBe(T0);
    });

    async function waitForPhase(phase: 'live') {
      for (let i = 0; i < 50 && useTranscriptStore.getState().entries[C]?.phase !== phase; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useTranscriptStore.getState().entries[C]?.phase).toBe(phase);
    }
  });

  // the review of M4: a boundary is told new by its row id, never by its time, which is the transcript machine's clock
  describe('a compaction’s boundary reaching the transcript', () => {
    const boundary = (id: string, atMs: number): Row => ({ id: `boundary:${id}` as RowId, turnId: null as TurnId | null, at: new Date(atMs).toISOString(), kind: 'boundary', boundaryKind: 'compaction', text: 'Context compacted', detail: null, hiddenRows: 0, revealed: false });
    const answer = (id: string): Row => ({ id: `text:${id}` as RowId, turnId: null as TurnId | null, at: new Date(T0).toISOString(), kind: 'assistant_text', messageUuid: null, blockIndex: 0, markdown: `Note ${id}.`, live: false, phase: 'answer', model: null });
    const withRows = (rows: Row[]) => useTranscriptStore.setState((state) => ({ entries: { ...state.entries, [A]: { ...state.entries[A], rows, phase: 'live' } as (typeof state.entries)[string] } }));
    const HOUR = 3_600_000;
    beforeEach(() => {
      disconnect = connectCompacting();
    });

    it.each([
      ['behind this window', -HOUR],
      ['ahead of this window', HOUR],
    ])('a new one turns it off whatever its time, its machine’s clock %s', (_, skew) => {
      withRows([answer('1'), boundary('old', T0 - 2 * HOUR)]);
      noteCompacting(A, bridge(R), true);
      withRows([answer('1'), boundary('old', T0 - 2 * HOUR), boundary('new', T0 + skew)]);
      expect(since(A)).toBeNull();
    });

    it('one already among the rows when it went on leaves it on through an unrelated update, even with a later time', () => {
      withRows([answer('1'), boundary('old', T0 + HOUR)]); // a machine ahead of this window wrote it before
      noteCompacting(A, bridge(R), true);
      withRows([answer('1'), boundary('old', T0 + HOUR), answer('2')]);
      expect(since(A)).toBe(T0);
    });
  });
});
