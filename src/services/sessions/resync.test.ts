// E10 Task 2.2: main's resync (E10 execution document, §Design 3 "Main's resync, and why it comes before `ready`"). The
// engine host is scripted: `engine.sessions` answers its rows' statuses and `session.events` pages a row's events as the
// host's stream does (whole journal rows, about `limit` events, `lastSeq` the next cursor). The fold is the real read
// model's; the burst and the live batches arrive through `hostEventSource`'s `session.eventBatch` listener.
import { describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { CommandResult, HostState, SessionDigest } from '@shared/ipc/schema';
import type { EventsSnapshot } from '@shared/ipc/schema/session';
import { record, status, T0 } from '../../../test/support/builders';
import { ev } from '../../../test/support/events';
import type { HostDispatch, HostResync } from '@shared/host/host-supervisor';
import { hostEventSource } from '.';
import { SessionReadModel } from './read-model';
import { randomUUID } from 'node:crypto';
import { loadJournal } from '../../../test/support/fixtures';
import { mintLaunchId } from '../../engine-host/launch';
import { Normalizer } from '../../engine-host/normalizer';
import { FoldFilter, RESYNC_PAGE } from './resync';

type Spec = [kind: Parameters<typeof ev>[0], overrides?: Record<string, unknown>];

// The events one journal row of a launch yields, with the normaliser's ids (`${appSessionId}:${launchId}:${seq}:${i}`).
function row(appSessionId: string, launchId: string, seq: number, ...specs: Spec[]): SessionEvent[] {
  return specs.map(([kind, overrides], i) => ev(kind, { ...overrides, id: `${appSessionId}:${launchId}:${seq}:${i}`, seq }));
}

// `session.events` as the host's stream answers it (session-stream.ts `page`): never a split row.
function page(source: SessionEvent[], afterSeq: number | null, limit: number | null): EventsSnapshot {
  let events = afterSeq === null ? [...source] : source.filter((e) => e.seq !== null && e.seq > afterSeq);
  let complete = true;
  if (limit !== null && events.length > limit) {
    let end = limit;
    while (end < events.length && events[end]!.seq === events[end - 1]!.seq) end += 1;
    if (end < events.length) {
      events = events.slice(0, end);
      complete = false;
    }
  }
  return { events, lastSeq: events.at(-1)?.seq ?? afterSeq ?? 0, complete };
}

const BATCH = 500; // the host's live batch size (SessionStream)
const CALL_CAP = 100; // more requests than any case here needs

function harness(ids: string[], { held = false }: { held?: boolean } = {}) {
  const rows = new Map<string, { status: EngineSessionStatus; events: SessionEvent[] }>();
  const calls: { name: string; input: unknown }[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  // P5 O3-D M2: mawsd's adapter replaying what it held while the spine loaded (Interfaces §A, step 4): what `drain`'s
  // callback sends is the hold, recorded whole and then delivered in order, each event seeing those after it (`later`)
  const replay = { barrier: false, replaying: false, drained: new Set<() => void>(), recording: null as { name: string; payload: unknown }[] | null, hold: [] as { name: string; payload: unknown }[], at: -1 };
  const fire = (name: string, payload: unknown) => {
    if (replay.recording) return void replay.recording.push({ name, payload });
    listeners.get(name)?.forEach((listener) => listener(payload));
  };
  const stateListeners = new Set<(state: HostState) => void>();
  const logs: string[] = [];
  let resync: HostResync | null = null;
  const gates = new Map<string, Promise<void>>(); // a row's `session.events` answers wait while it has one
  const failing = new Set<string>(); // rows whose `session.events` fails
  const answers = new Map<string, () => EventsSnapshot>(); // rows whose `session.events` answer is scripted whole
  const ok = <T,>(value: T) => ({ ok: true, value }) as CommandResult<never>;
  const dispatch: HostDispatch = async (_owner, name, input) => {
    calls.push({ name, input });
    // a resync that loops on an answer fails here at once rather than hanging the test
    if (calls.length > CALL_CAP) throw new Error(`the resync asked the host more than ${CALL_CAP} times: a loop`);
    if (name === 'engine.sessions') return ok([...rows.values()].map((r) => r.status));
    if (name === 'session.events') {
      const { appSessionId, afterSeq, limit } = input as { appSessionId: string; afterSeq: number | null; limit: number | null };
      await gates.get(appSessionId);
      if (failing.has(appSessionId)) return { ok: false, error: { code: 'internal', message: 'the journal could not be read' } } as CommandResult<never>;
      const scripted = answers.get(appSessionId);
      if (scripted) return ok(scripted());
      return ok(page(rows.get(appSessionId)?.events ?? [], afterSeq, limit));
    }
    throw new Error(`unscripted ${name}`);
  };
  const hosts = {
    onEvent: (name: string, listener: (payload: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => void listeners.get(name)!.delete(listener);
    },
    onState: (_owner: string, listener: (state: HostState) => void) => (stateListeners.add(listener), () => void stateListeners.delete(listener)),
    setResync: (_owner: string, next: HostResync | null) => void (resync = next),
    ...(held && {
      replay: {
        barrier: () => replay.barrier,
        replaying: () => replay.replaying,
        later: () => replay.hold.slice(replay.at + 1),
        onDrained: (listener: () => void) => (replay.drained.add(listener), () => void replay.drained.delete(listener)),
      },
    }),
  };
  const model = new SessionReadModel('index');
  model.register({ start: (writer) => (ids.forEach((id) => writer.observeRecord(record(id))), () => {}) });
  const stop = model.register(hostEventSource(hosts as never, (line) => void logs.push(line)));
  return {
    model,
    rows,
    calls,
    logs,
    failing,
    answers,
    stop,
    registered: () => resync,
    // holds the answers to a row's pages until released
    hold(appSessionId: string) {
      let release!: () => void;
      gates.set(appSessionId, new Promise<void>((resolve) => (release = resolve)));
      return () => {
        gates.delete(appSessionId);
        release();
      };
    },
    // The host's rows as they stand when main connects.
    host(appSessionId: string, rowStatus: EngineSessionStatus, events: SessionEvent[]) {
      rows.set(appSessionId, { status: rowStatus, events });
    },
    // main's connect: the resync between the welcome and the ready line
    connect(signal: AbortSignal = new AbortController().signal) {
      return resync!(dispatch, signal);
    },
    // events as the host writes them after the ready line (the burst's tail, then live), in batches
    deliver(appSessionId: string, events: SessionEvent[]) {
      for (let i = 0; i < events.length; i += BATCH) fire('session.eventBatch', { appSessionId, events: events.slice(i, i + BATCH) });
    },
    status(rowStatus: EngineSessionStatus) {
      fire('session.status', { appSessionId: rowStatus.appSessionId, status: rowStatus });
    },
    // P5 O3-D M2: a listener of raw batches beside the fold (attention's core, the owner channel, side threads)
    raw() {
      const seen: SessionEvent[] = [];
      hosts.onEvent('session.eventBatch', (payload) => void seen.push(...(payload as { events: SessionEvent[] }).events));
      return seen;
    },
    // the load's barrier: from the trigger, then the coalesced parts and the resync; `drain` replays the hold in order
    // and ends it
    begin() {
      replay.barrier = true;
    },
    drain(held: () => void) {
      replay.recording = [];
      try {
        held();
      } finally {
        replay.hold = replay.recording;
        replay.recording = null;
      }
      replay.replaying = true;
      try {
        for (replay.at = 0; replay.at < replay.hold.length; replay.at += 1) fire(replay.hold[replay.at]!.name, replay.hold[replay.at]!.payload);
      } finally {
        replay.hold = [];
        replay.at = -1;
        replay.replaying = false;
        replay.barrier = false;
      }
      for (const listener of [...replay.drained]) listener();
    },
    transition(state: HostState['state']) {
      stateListeners.forEach((l) => l({ state, pid: 1, restarts: 0, revision: 0 }));
    },
    digest: (appSessionId: string): Omit<SessionDigest, 'revision'> | undefined => {
      const found = model.digests().find((d) => d.appSessionId === appSessionId);
      if (!found) return undefined;
      const { revision: _revision, ...rest } = found;
      void _revision;
      return rest;
    },
    pages: (appSessionId: string) => calls.filter((c) => c.name === 'session.events' && (c.input as { appSessionId: string }).appSessionId === appSessionId).map((c) => c.input),
  };
}

const live = (appSessionId: string, launchId: string, over: Parameters<typeof status>[1] = {}): EngineSessionStatus => ({ ...status(appSessionId, over), launchId });

// Subagent pairs, one row each: a pair folded twice doubles `childAgents.done`, one half lost leaves `active` above 0.
function pairs(appSessionId: string, launchId: string, from: number, to: number): SessionEvent[] {
  const events: SessionEvent[] = [];
  for (let seq = from; seq <= to; seq += 1) events.push(...row(appSessionId, launchId, seq, ['subagent.started', { taskId: `t${seq}` }], ['subagent.finished', { taskId: `t${seq}` }]));
  return events;
}

// A launch's worth of varied history: turns with tools, requests and their answers, samples, child agents.
function history(appSessionId: string, launchId: string, rowsWanted: number): SessionEvent[] {
  const events: SessionEvent[] = [];
  let seq = 0;
  let cost = 0;
  const add = (...specs: Spec[]) => events.push(...row(appSessionId, launchId, ++seq, ...specs));
  while (seq < rowsWanted) {
    add(['turn.started', {}], ['assistant.block.delta', {}]);
    add(['tool.use', { toolName: 'Grep' }]);
    add(['permission.requested', {}]);
    add(['permission.resolved', {}], ['tool.result', {}]);
    add(['subagent.started', { taskId: `t${seq}` }]);
    add(['context.sample', { totalTokens: seq * 10, maxTokens: 200_000, percentage: seq % 100 }]);
    add(['subagent.finished', { taskId: `t${seq}` }]);
    cost += 0.01;
    add(['assistant.block.complete', { block: { type: 'text', text: `line ${seq}` } }], ['usage.sample', { costUsd: cost }], ['turn.ended', { costUsd: cost }]);
  }
  return events;
}

describe('main’s resync (E10 Task 2.2)', () => {
  it('registers the resync with the host supervisor while the source runs', () => {
    const h = harness(['a1']);
    expect(h.registered()).toBeTypeOf('function');
    h.stop();
    expect(h.registered()).toBeNull();
  });

  it('a tail with a turn.ended and a resolved permission arriving after the resync leaves the digest idle with no pending request', async () => {
    const A = 'a1';
    // the previous app run saw rows 1 and 2; rows 3 and 4 happened while it was closed
    const seen = [...row(A, 'L1', 1, ['turn.started', {}]), ...row(A, 'L1', 2, ['permission.requested', {}])];
    const away = [...row(A, 'L1', 3, ['permission.resolved', {}], ['tool.result', {}]), ...row(A, 'L1', 4, ['turn.ended', {}])];
    const h = harness([A]);
    h.host(A, live(A, 'L1'), [...seen, ...away]);
    await h.connect();
    expect(h.pages(A)).toEqual([{ appSessionId: A, afterSeq: null, limit: RESYNC_PAGE }]);
    h.status(live(A, 'L1')); // the burst: the row's state, then the undelivered tail
    h.deliver(A, away);
    expect(h.digest(A)).toMatchObject({ phase: 'idle', pendingRequests: 0, activity: null });
  });

  it('applies each row’s status before folding its history, so a live row’s history moves its phase', async () => {
    const A = 'a1';
    const h = harness([A]);
    h.host(A, live(A, 'L1', { engineState: 'running', turn: { origin: 'human', startedAt: '2026-10-06T10:00:00.000Z', userMessageUuids: [] } }), [
      ...row(A, 'L1', 1, ['turn.started', {}]),
      ...row(A, 'L1', 2, ['tool.use', { toolName: 'Grep' }]),
    ]);
    await h.connect();
    expect(h.model.engineStatus(A as AppSessionId)?.launchId).toBe('L1');
    expect(h.digest(A)).toMatchObject({ phase: 'working', activity: 'Searching' });
  });

  it('a tail of 3,000 events overlapping the fold’s end folds none twice', async () => {
    const A = 'a1';
    const events = pairs(A, 'L1', 1, 1_500); // 3,000 events, past the page size and the fold's id window
    const h = harness([A]);
    h.host(A, live(A, 'L1'), events);
    await h.connect();
    expect(h.pages(A).map((p) => (p as { afterSeq: number | null }).afterSeq)).toEqual([null, 1_000]);
    h.deliver(A, events); // nothing of it was ever delivered: the burst carries it all
    expect(h.digest(A)?.childAgents).toEqual({ active: 0, done: 1_500 });
  });

  it('digests after a resync and the tail equal digests after live folding of the same events', async () => {
    const A = 'a1';
    const events = history(A, 'L1', 1_100); // about 1,600 events
    const upTo = (seq: number) => events.filter((e) => e.seq! <= seq);
    const after = (seq: number) => events.filter((e) => e.seq! > seq);
    const rowStatus = live(A, 'L1');

    const control = harness([A]);
    control.status(rowStatus);
    control.deliver(A, events);

    // the previous app run received rows up to 400; the host held rows up to 900 at the connect; the rest is live
    const h = harness([A]);
    h.host(A, rowStatus, upTo(900));
    await h.connect();
    h.status(rowStatus);
    h.deliver(A, after(400).filter((e) => e.seq! <= 900)); // the burst's undelivered tail
    h.deliver(A, after(900)); // live
    expect(h.digest(A)).toEqual(control.digest(A));
    expect(h.digest(A)?.childAgents.done).toBeGreaterThan(100);
  });

  it('an in-run reconnect of the same launch pages from the fold’s position, and no child agent is counted twice or lost', async () => {
    const A = 'a1';
    const h = harness([A]);
    h.host(A, live(A, 'L1'), pairs(A, 'L1', 1, 10));
    await h.connect();
    h.deliver(A, pairs(A, 'L1', 11, 19));
    const row20 = pairs(A, 'L1', 20, 20);
    h.deliver(A, row20.slice(0, 1)); // a batch split row 20; the connection closed before its second half was written
    h.transition('restarting'); // a backpressure close: the same supervisor, the same launch
    h.transition('ready');
    h.host(A, live(A, 'L1'), pairs(A, 'L1', 1, 25));
    await h.connect();
    // the fold holds row 20 in part: the page starts at that row and the filter drops what the fold already has
    expect(h.pages(A).at(-1)).toEqual({ appSessionId: A, afterSeq: 19, limit: RESYNC_PAGE });
    h.status(live(A, 'L1'));
    h.deliver(A, [...row20.slice(1), ...pairs(A, 'L1', 21, 25)]); // the burst: what no client received
    expect(h.digest(A)?.childAgents).toEqual({ active: 0, done: 25 });
  });

  it('a row with a new launch is folded from its start, and the new launch’s events pass the filter', async () => {
    const A = 'a1';
    const h = harness([A]);
    h.host(A, live(A, 'L1'), pairs(A, 'L1', 1, 30));
    await h.connect();
    expect(h.digest(A)?.childAgents.done).toBe(30);
    h.transition('restarting');
    h.transition('ready');
    h.host(A, live(A, 'L2'), pairs(A, 'L2', 1, 3)); // a relaunch while the app was away: seq starts again at 1
    await h.connect();
    expect(h.pages(A).at(-1)).toEqual({ appSessionId: A, afterSeq: null, limit: RESYNC_PAGE });
    expect(h.digest(A)?.childAgents.done).toBe(33);
    h.deliver(A, pairs(A, 'L2', 1, 5)); // the tail: rows 1 to 3 are the fold's already
    expect(h.digest(A)?.childAgents).toEqual({ active: 0, done: 35 });
  });

  it('events main synthesised (seq null) pass the filter', async () => {
    const A = 'a1';
    const h = harness([A]);
    h.host(A, live(A, 'L1'), [...row(A, 'L1', 1, ['turn.started', {}]), ...row(A, 'L1', 2, ['turn.ended', {}])]);
    await h.connect();
    expect(h.digest(A)?.phase).toBe('idle');
    h.deliver(A, [ev('turn.started', { id: `${A}:c10:notice`, seq: null })]);
    expect(h.digest(A)?.phase).toBe('working');
  });

  // Decision Log (d0e3de60): live rows only
  it('an exited row has its status applied and is not paged; its undelivered tail folds once from the burst', async () => {
    const A = 'a1';
    const B = 'b2';
    const h = harness([A, B]);
    h.host(A, live(A, 'L1'), pairs(A, 'L1', 1, 2));
    h.host(B, live(B, 'L9', { process: 'exited' }), pairs(B, 'L9', 1, 4));
    await h.connect();
    expect(h.pages(A)).toHaveLength(1);
    expect(h.pages(B)).toEqual([]);
    expect(h.model.engineStatus(B as AppSessionId)?.process).toBe('exited');
    expect(h.digest(B)?.phase).toBe('exited');
    const line = { type: 'text', text: 'written after the exit was announced' };
    h.deliver(B, row(B, 'L9', 5, ['assistant.block.complete', { block: line }])); // the burst: what no client received, through the empty filter
    expect(h.digest(B)).toMatchObject({ phase: 'exited', lastAssistantLine: line.text }); // folded, and an exited process's history moves no phase
  });

  it('an exited row of a launch main already folded this run is paged from its position: an in-run reconnect leaves no stale request', async () => {
    const A = 'a1';
    const h = harness([A]);
    h.host(A, live(A, 'L1'), row(A, 'L1', 1, ['turn.started', {}]));
    await h.connect();
    h.deliver(A, row(A, 'L1', 2, ['permission.requested', {}])); // live
    expect(h.digest(A)?.pendingRequests).toBe(1);
    // the connection closed with rows 3 and 4 written and never read; the row exited during the gap
    const gap = [...row(A, 'L1', 3, ['permission.resolved', {}], ['tool.result', {}]), ...row(A, 'L1', 4, ['turn.ended', {}])];
    h.transition('restarting');
    h.transition('ready');
    h.host(A, live(A, 'L1', { process: 'exited' }), [...row(A, 'L1', 1, ['turn.started', {}]), ...row(A, 'L1', 2, ['permission.requested', {}]), ...gap]);
    await h.connect();
    expect(h.pages(A).at(-1)).toEqual({ appSessionId: A, afterSeq: 1, limit: RESYNC_PAGE });
    expect(h.digest(A)).toMatchObject({ phase: 'exited', pendingRequests: 0 });
  });

  it('an exited row of another launch than the one main folded is not paged', async () => {
    const A = 'a1';
    const h = harness([A]);
    h.host(A, live(A, 'L1'), row(A, 'L1', 1, ['turn.started', {}]));
    await h.connect();
    h.transition('restarting');
    h.transition('ready');
    h.host(A, live(A, 'L2', { process: 'exited' }), row(A, 'L2', 1, ['turn.started', {}]));
    await h.connect();
    expect(h.pages(A)).toHaveLength(1); // the first connect's page only
  });

  it('a disk answer still backfilling (seq-null events, complete false, the cursor unmoved) ends the row after one page, folding nothing', async () => {
    const A = 'a1';
    const B = 'b2';
    const h = harness([A, B]);
    h.host(A, live(A, 'L1'), []);
    h.host(B, live(B, 'L1'), pairs(B, 'L1', 1, 2));
    const fromDisk = ev('assistant.block.complete', { id: 'uuid-1', seq: null, block: { type: 'text', text: 'from the transcript' } });
    h.answers.set(A, () => ({ events: [fromDisk], lastSeq: 0, complete: false }));
    await h.connect();
    expect(h.pages(A)).toEqual([{ appSessionId: A, afterSeq: null, limit: RESYNC_PAGE }]);
    expect(h.digest(A)?.lastAssistantLine ?? null).toBeNull();
    expect(h.digest(B)?.childAgents.done).toBe(2); // the rows after it are paged
  });

  it('a page that does not move the cursor ends the row', async () => {
    const A = 'a1';
    const h = harness([A]);
    h.host(A, live(A, 'L1'), []);
    const first = pairs(A, 'L1', 1, 1);
    h.answers.set(A, () => ({ events: first, lastSeq: 1, complete: false })); // the same answer however asked
    await h.connect();
    expect(h.pages(A).map((p) => (p as { afterSeq: number | null }).afterSeq)).toEqual([null, 1]);
    expect(h.digest(A)?.childAgents.done).toBe(1);
  });

  // launchOf reads the normaliser's event id: a change of that form must fail here, not pass every event silently
  it('tracks the events the real normaliser mints: a second delivery of them is dropped for the fold', () => {
    const appSessionId = randomUUID() as AppSessionId;
    const launchId = mintLaunchId();
    const normalizer = new Normalizer({ appSessionId, launchId, sessionId: null });
    const events = loadJournal('pass1', 'subagent').flatMap((journalRow) => normalizer.push(journalRow)).filter((event) => event.seq !== null);
    expect(events.length).toBeGreaterThan(3);
    const filter = new FoldFilter();
    expect(filter.pass(appSessionId, events)).toEqual(events);
    expect(filter.position(appSessionId)).toMatchObject({ launchId, lastSeq: events.at(-1)!.seq });
    expect(filter.pass(appSessionId, events)).toEqual([]);
  });

  it('a host transition mid-resync cancels it: nothing more is asked or folded', async () => {
    const A = 'a1';
    const B = 'b2';
    const h = harness([A, B]);
    h.host(A, live(A, 'L1'), pairs(A, 'L1', 1, 5));
    h.host(B, live(B, 'L1'), pairs(B, 'L1', 1, 5));
    const controller = new AbortController();
    const release = h.hold(A);
    const running = h.connect(controller.signal);
    await vi.waitFor(() => expect(h.pages(A)).toHaveLength(1));
    controller.abort('transition'); // the page for A is in flight when the host leaves ready
    release();
    await running;
    expect(h.pages(B)).toEqual([]);
    expect(h.digest(A)?.childAgents.done ?? 0).toBe(0);
  });

  it('at the bound the rows left are logged, and their digests fold from the tail with the filter empty', async () => {
    const A = 'a1';
    const B = 'b2';
    const h = harness([A, B]);
    h.host(A, live(A, 'L1'), pairs(A, 'L1', 1, 5));
    h.host(B, live(B, 'L1'), pairs(B, 'L1', 1, 5));
    const controller = new AbortController();
    const release = h.hold(B);
    const running = h.connect(controller.signal);
    await vi.waitFor(() => expect(h.pages(B)).toHaveLength(1));
    expect(h.digest(A)?.childAgents.done).toBe(5);
    controller.abort('bound'); // the supervisor's RESYNC_BOUND_MS: the ready line goes now
    release();
    await running;
    expect(h.logs.join('\n')).toMatch(/1 row.*not folded.*b2/);
    expect(h.digest(B)?.childAgents.done ?? 0).toBe(0);
    h.deliver(A, pairs(A, 'L1', 1, 5)); // the burst
    h.deliver(B, pairs(B, 'L1', 1, 5));
    expect(h.digest(A)?.childAgents.done).toBe(5);
    expect(h.digest(B)?.childAgents.done).toBe(5);
  });

  it('a row whose page fails is logged and left to the tail; the other rows fold', async () => {
    const A = 'a1';
    const B = 'b2';
    const h = harness([A, B]);
    h.host(A, live(A, 'L1'), pairs(A, 'L1', 1, 2));
    h.host(B, live(B, 'L1'), pairs(B, 'L1', 1, 2));
    h.failing.add(A);
    await h.connect();
    expect(h.logs.join('\n')).toContain('the journal could not be read');
    expect(h.digest(B)?.childAgents.done).toBe(2);
    h.deliver(A, pairs(A, 'L1', 1, 2));
    expect(h.digest(A)?.childAgents.done).toBe(2);
  });
});

// P5 O3-D M2 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §A, step 4; D8, D31): `mawsd` held the
// engine host's events while the spine loaded, then subscribes, replays the coalesced parts, resyncs the digest over the
// journal, and drains the hold in order to every listener. The drain is launch-aware: a held event of the session's
// current launch (the listing's, or a held status's since) folds through the filter, one of another launch reaches the
// raw listeners only, and a session that exited meanwhile folds its held batches as its launch's lifecycle before its
// exited status applies.
describe('the load’s barrier in mawsd (P5 O3-D M2)', () => {
  const exited = (appSessionId: string, launchId: string, reason: 'crash' | 'quit') =>
    live(appSessionId, launchId, { process: 'exited', exit: { reason } } as Parameters<typeof status>[1]);

  it('a held tail at seq 100 against a journal holding 1 to 99 folds after the journal’s pages, each event once', async () => {
    const A = 'a1';
    const h = harness([A], { held: true });
    const raw = h.raw();
    h.host(A, live(A, 'L1'), pairs(A, 'L1', 1, 99));
    h.begin();
    await h.connect();
    const tail = pairs(A, 'L1', 97, 100); // the burst overlaps the journal's end
    h.drain(() => h.deliver(A, tail));
    expect(h.digest(A)?.childAgents).toEqual({ active: 0, done: 100 });
    expect(raw).toEqual(tail); // the raw listeners hear the held batch once
  });

  it('a relaunch during the load: the new launch’s 2,400 held events fold once, the old launch’s tail reaches the raw listeners only', async () => {
    const X = 'x1';
    const h = harness([X], { held: true });
    const raw = h.raw();
    h.begin();
    h.status(live(X, 'LA')); // coalesced while cold: launch A was live
    h.host(X, live(X, 'LB'), pairs(X, 'LB', 1, 1_200)); // the listing names B, whose journal the resync pages
    await h.connect();
    const tailA = pairs(X, 'LA', 50, 60);
    const heldB = pairs(X, 'LB', 1, 1_200); // overlapping the journal, past the fold's id window
    h.drain(() => {
      h.deliver(X, tailA);
      h.status(live(X, 'LB'));
      h.deliver(X, heldB);
    });
    expect(h.digest(X)?.childAgents).toEqual({ active: 0, done: 1_200 }); // B once; nothing of A; the filter never reset to A
    expect(raw.filter((event) => event.id.includes(':LA:'))).toEqual(tailA);
    h.deliver(X, pairs(X, 'LB', 1_201, 1_201)); // live after the drain
    expect(h.digest(X)?.childAgents.done).toBe(1_201);
  });

  it('a relaunch during the load whose hold carries the old launch’s status before its tail: the resynced launch stays protected, its 2,400 events fold once', async () => {
    const X = 'x1';
    const h = harness([X], { held: true });
    const raw = h.raw();
    const launchA = { ...live(X, 'LA'), launchedAt: '2026-09-28T09:00:00.000Z' }; // launched before B
    h.begin();
    h.host(X, live(X, 'LB'), pairs(X, 'LB', 1, 1_200)); // the listing names B, whose journal the resync pages
    await h.connect();
    const tailA = pairs(X, 'LA', 50, 60);
    const heldB = pairs(X, 'LB', 1, 1_200); // overlapping the journal, past the fold's id window
    h.drain(() => {
      h.status(launchA); // held before the relaunch: superseded by the listing's B
      h.deliver(X, tailA);
      h.status(live(X, 'LB'));
      h.deliver(X, heldB);
    });
    expect(h.digest(X)?.childAgents).toEqual({ active: 0, done: 1_200 }); // B once; nothing of A; the filter never reset to A
    expect(raw.filter((event) => event.id.includes(':LA:'))).toEqual(tailA); // A's tail reaches the raw listeners
    expect(h.model.engineStatus(X as AppSessionId)?.launchId).toBe('LB');
    h.deliver(X, pairs(X, 'LB', 1_201, 1_201));
    expect(h.digest(X)?.childAgents.done).toBe(1_201);
  });

  // the fence is the hold's own order, not the launches' wall-clock times, which the status contract does not order
  for (const [what, launchedAt] of [['the same', T0], ['a later', '2026-09-28T11:00:00.000Z']] as const) {
    it(`the old launch’s held status is superseded with ${what} launch time as the resynced launch’s`, async () => {
      const X = 'x1';
      const h = harness([X], { held: true });
      const raw = h.raw();
      h.begin();
      h.host(X, live(X, 'LB'), pairs(X, 'LB', 1, 1_200));
      await h.connect();
      const tailA = pairs(X, 'LA', 50, 60);
      h.drain(() => {
        h.status({ ...live(X, 'LA'), launchedAt });
        h.deliver(X, tailA);
        h.status(live(X, 'LB'));
        h.deliver(X, pairs(X, 'LB', 1, 1_200));
      });
      expect(h.digest(X)?.childAgents).toEqual({ active: 0, done: 1_200 });
      expect(raw.filter((event) => event.id.includes(':LA:'))).toEqual(tailA);
      expect(h.model.engineStatus(X as AppSessionId)?.launchId).toBe('LB');
    });
  }

  it('a relaunch to a third launch held after the listing applies, and its held events fold', async () => {
    const X = 'x1';
    const h = harness([X], { held: true });
    h.begin();
    h.host(X, live(X, 'LB'), pairs(X, 'LB', 1, 10)); // the listing names B
    await h.connect();
    expect(h.digest(X)?.childAgents.done).toBe(10);
    h.drain(() => {
      h.deliver(X, pairs(X, 'LB', 11, 12)); // B's last events
      h.status({ ...live(X, 'LC'), launchedAt: '2026-09-28T09:00:00.000Z' }); // C, even with an earlier clock
      h.deliver(X, pairs(X, 'LC', 1, 3));
    });
    expect(h.model.engineStatus(X as AppSessionId)?.launchId).toBe('LC');
    expect(h.digest(X)?.childAgents.done).toBe(15); // B's 12, then C's 3 folded (raw-only, they would read 12)
    h.deliver(X, pairs(X, 'LC', 4, 4)); // live
    expect(h.digest(X)?.childAgents.done).toBe(16);
  });

  it('a session that exits during the load with a crash in its held final batch reads failed, its turn’s end kept', async () => {
    const A = 'a1';
    const h = harness([A], { held: true });
    h.host(A, exited(A, 'L1', 'crash'), row(A, 'L1', 1, ['turn.started', {}])); // listed exited: not paged
    h.begin();
    await h.connect();
    expect(h.digest(A)?.phase).not.toBe('exited'); // its exited status waits for its held batches
    h.drain(() => {
      h.deliver(A, [...row(A, 'L1', 2, ['turn.ended', {}]), ...row(A, 'L1', 3, ['process.exited', { reason: 'crash', code: 1 }])]);
      h.status(exited(A, 'L1', 'crash'));
    });
    expect(h.digest(A)).toMatchObject({ phase: 'failed' });
    expect(h.digest(A)?.lastTurnEndedAt).not.toBeNull();
    expect(h.model.engineStatus(A as AppSessionId)?.process).toBe('exited');
  });

  it('a fresh load with no retained live status folds a held crash as its lifecycle, and applies the listed exit after it', async () => {
    const A = 'a1';
    const h = harness([A], { held: true });
    h.begin();
    h.status(exited(A, 'L1', 'crash')); // coalesced while cold: the exit, before the hold's batch is replayed
    h.host(A, exited(A, 'L1', 'crash'), []);
    await h.connect();
    h.drain(() => h.deliver(A, row(A, 'L1', 9, ['process.exited', { reason: 'crash', code: 1 }])));
    expect(h.digest(A)?.phase).toBe('failed');
    expect(h.model.engineStatus(A as AppSessionId)?.process).toBe('exited'); // the deferred status, applied after the drain
  });

  it('outside a barrier the fold is as before: an exited status applies at once and a later batch is history', async () => {
    const A = 'a1';
    const h = harness([A], { held: true });
    h.host(A, exited(A, 'L1', 'quit'), []);
    await h.connect(); // a resync with no hold (a reconnect while loaded)
    expect(h.model.engineStatus(A as AppSessionId)?.process).toBe('exited');
    h.deliver(A, row(A, 'L1', 4, ['process.exited', { reason: 'crash', code: 1 }]));
    expect(h.digest(A)?.phase).toBe('exited');
  });
});
