// E10 Task 2.2: main's resync (E10 execution document, §Design 3 "Main's resync, and why it comes before `ready`"). The
// engine host is scripted: `engine.sessions` answers its rows' statuses and `session.events` pages a row's events as the
// host's stream does (whole journal rows, about `limit` events, `lastSeq` the next cursor). The fold is the real read
// model's; the burst and the live batches arrive through `hostEventSource`'s `session.eventBatch` listener.
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }));

import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { CommandResult, HostState, SessionDigest } from '@shared/ipc/schema';
import type { EventsSnapshot } from '@shared/ipc/schema/session';
import { record, status } from '../../../test/support/builders';
import { ev } from '../../../test/support/events';
import type { HostResync } from '../hosts/supervisor';
import type { HostDispatch } from '../ipc/router';
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

function harness(ids: string[]) {
  const rows = new Map<string, { status: EngineSessionStatus; events: SessionEvent[] }>();
  const calls: { name: string; input: unknown }[] = [];
  const listeners = new Map<string, (payload: unknown) => void>();
  const stateListeners = new Set<(state: HostState) => void>();
  const logs: string[] = [];
  let resync: HostResync | null = null;
  const gates = new Map<string, Promise<void>>(); // a row's `session.events` answers wait while it has one
  const failing = new Set<string>(); // rows whose `session.events` fails
  const answers = new Map<string, () => EventsSnapshot>(); // rows whose `session.events` answer is scripted whole
  const ok = <T,>(value: T) => ({ ok: true, value }) as CommandResult<never>;
  const dispatch: HostDispatch = async (_owner, name, input) => {
    calls.push({ name, input });
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
    onEvent: (name: string, listener: (payload: unknown) => void) => (listeners.set(name, listener), () => void listeners.delete(name)),
    onState: (_owner: string, listener: (state: HostState) => void) => (stateListeners.add(listener), () => void stateListeners.delete(listener)),
    setResync: (_owner: string, next: HostResync | null) => void (resync = next),
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
      for (let i = 0; i < events.length; i += BATCH) listeners.get('session.eventBatch')!({ appSessionId, events: events.slice(i, i + BATCH) });
    },
    status(rowStatus: EngineSessionStatus) {
      listeners.get('session.status')!({ appSessionId: rowStatus.appSessionId, status: rowStatus });
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
    h.deliver(B, row(B, 'L9', 5, ['permission.requested', {}])); // the burst: what no client received, through the empty filter
    expect(h.digest(B)).toMatchObject({ phase: 'exited', pendingRequests: 1 }); // history of an exited process moves no phase
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
