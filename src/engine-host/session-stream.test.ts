import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { replayedSession } from './conformance/session-harness';
import { JOURNAL_MAX_BYTES, JournalWriter } from './journal';
import { Normalizer } from './normalizer';
import { SessionStream } from './session-stream';
// E10 start
import { status as engineStatus } from '../../test/support/builders';
import { ev } from '../../test/support/events';
// E10 end

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maws-stream-'));
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

type Emitted = { name: EventName; payload: unknown };
function recorder() {
  const emitted: Emitted[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
    emitted.push({ name, payload });
    return true;
  };
  return { emitted, emit };
}

// A live run of pass1/reads (its one turn; the replay ends at the first read) journaled to disk by the production
// writer, and the events it produced.
async function recordedInit(): Promise<{ events: SessionEvent[]; launchId: string; sessionId: string; appSessionId: AppSessionId; status: EngineSessionStatus; journalPath: string }> {
  const writer = new JournalWriter(dir, 'LAUNCHS1', { maxBytes: JOURNAL_MAX_BYTES });
  const run = await replayedSession('pass1', 'reads', (row, { session, ready, fixture, transport }) => {
    const frame = row.frame as { type: string };
    if (frame.type === 'user') void ready().then(() => session.send((fixture.find((r) => r.seq === row.seq)!.frame as { message: { content: string } }).message.content));
    else transport.kill('SIGTERM');
  }, { session: { journal: writer } });
  const status = run.session.status();
  // the live normaliser was constructed with the plan's id (the first events carry it, until system/init names the engine's)
  return { events: run.events, launchId: status.launchId, sessionId: run.events[0]!.sessionId, appSessionId: status.appSessionId, status, journalPath: writer.path };
}

describe('session event stream: batches, the ring and the reload snapshot', () => {
  it('batches per 16 ms, at most 500 per batch, and flushes before a status so a status never runs ahead of its events', async () => {
    const { events, status, journalPath } = await recordedInit();
    vi.useFakeTimers();
    const { emitted, emit } = recorder();
    const stream = new SessionStream({ appSessionId: 'app-b' as AppSessionId, launchId: 'L', sessionId: null, journalPath, emit });
    const sample = events;
    stream.events(sample.slice(0, 3));
    expect(emitted).toEqual([]);
    await vi.advanceTimersByTimeAsync(16);
    expect(emitted).toEqual([{ name: 'session.eventBatch', payload: { appSessionId: 'app-b', events: sample.slice(0, 3) } }]);

    emitted.length = 0;
    const many = Array.from({ length: Math.ceil(1_200 / sample.length) }, () => sample).flat().slice(0, 1_200);
    stream.events(many);
    expect(emitted.map((e) => (e.payload as { events: unknown[] }).events.length)).toEqual([500, 500]);
    await vi.advanceTimersByTimeAsync(16);
    expect(emitted.map((e) => (e.payload as { events: unknown[] }).events.length)).toEqual([500, 500, 200]);

    emitted.length = 0;
    stream.events(sample.slice(3, 5));
    stream.status({ ...status, appSessionId: 'app-b' as AppSessionId });
    expect(emitted.map((e) => e.name)).toEqual(['session.eventBatch', 'session.status']);
    stream.queue({ entries: [], paused: true });
    stream.brokerItems([]);
    expect(emitted.map((e) => e.name)).toEqual(['session.eventBatch', 'session.status', 'session.queue', 'session.brokerItems']);
    stream.dispose();
  });

  it('answers from the ring while it holds the range and from the journal once it evicted it; ids and seq identical', async () => {
    const { events, launchId, sessionId, appSessionId, journalPath } = await recordedInit();
    const { emit } = recorder();
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit, ringSize: 10 });
    stream.events(events);
    stream.flush();
    expect(events.length).toBeGreaterThan(20);

    const all = await stream.snapshot(null, null);
    expect(all).toEqual({ events, lastSeq: events.at(-1)!.seq, complete: true });

    const mid = events[Math.floor(events.length / 2)]!.seq!;
    const after = await stream.snapshot(mid, null);
    expect(after.events).toEqual(events.filter((e) => e.seq! > mid));
    expect(after.complete).toBe(true);

    const tail = events.at(-3)!.seq!; // inside the ring
    expect((await stream.snapshot(tail, null)).events).toEqual(events.filter((e) => e.seq! > tail));
    expect(await stream.snapshot(events.at(-1)!.seq!, null)).toEqual({ events: [], lastSeq: events.at(-1)!.seq, complete: true });
  });

  it('a limit never splits one row\'s events and marks the answer incomplete; lastSeq is the cursor for the next page', async () => {
    const { events, launchId, sessionId, appSessionId, journalPath } = await recordedInit();
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit });
    stream.events(events);
    const seqWithTwo = events.find((e, i) => events[i + 1]?.seq === e.seq)!.seq!; // a row with several events
    const before = events.filter((e) => e.seq! < seqWithTwo).length;
    const page = await stream.snapshot(null, before + 1);
    expect(page.events.at(-1)!.seq).toBe(seqWithTwo);
    expect(page.events.length).toBe(events.filter((e) => e.seq! <= seqWithTwo).length);
    expect(page.complete).toBe(false);
    expect(page.lastSeq).toBe(seqWithTwo);
    const rest = await stream.snapshot(page.lastSeq, null);
    expect([...page.events, ...rest.events]).toEqual(events);
  });

  // Whole-branch review: paging an evicted range must not rebuild the whole launch per page.
  it('paging a rebuilt journal reads each row once across the pages, and a page stops at its limit', async () => {
    const { events, launchId, sessionId, appSessionId, journalPath } = await recordedInit();
    const rows = readFileSync(journalPath, 'utf8').trim().split('\n').length;
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, ringSize: 5 });
    stream.events(events);
    stream.flush();
    const push = vi.spyOn(Normalizer.prototype, 'push');
    const first = await stream.snapshot(null, 5);
    expect(first.complete).toBe(false);
    expect(first.events).toEqual(events.slice(0, first.events.length));
    const firstReads = push.mock.calls.length;
    const pages = [first];
    while (!pages.at(-1)!.complete) pages.push(await stream.snapshot(pages.at(-1)!.lastSeq, 5));
    expect(pages.flatMap((p) => p.events)).toEqual(events);
    expect(pages.length).toBeGreaterThan(3);
    // the first page stopped at the row that opens the second, not at the end of the journal
    expect(firstReads).toBe(pages[1]!.events[0]!.seq);
    expect(firstReads).toBeLessThan(rows);
    expect(push.mock.calls.length).toBe(rows); // every row normalised once over all the pages
  });

  it('a paging cursor follows the journal as it grows, and a page from the start rebuilds from the first row', async () => {
    const { events, launchId, sessionId, appSessionId, journalPath } = await recordedInit();
    const lastRow = Number((JSON.parse(readFileSync(journalPath, 'utf8').trim().split('\n').at(-1)!) as { seq: number }).seq);
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, ringSize: 5 });
    stream.events(events);
    const push = vi.spyOn(Normalizer.prototype, 'push');
    const first = await stream.snapshot(null, 5);
    expect(first.complete).toBe(false);
    // the launch writes on while the renderer pages (the ring's side of it does not matter to a journal page)
    const notice = { seq: lastRow + 1, direction: 'meta', at: '2026-09-28T10:00:00.000Z', frame: { event: 'notice', level: 'info', key: 'appended', text: 'a row written after the first page' } };
    appendFileSync(journalPath, `${JSON.stringify(notice)}\n`);
    const rest = await stream.snapshot(first.lastSeq, null);
    expect(rest.complete).toBe(true);
    expect([...first.events, ...rest.events].slice(0, events.length)).toEqual(events);
    expect(rest.events.at(-1)).toMatchObject({ kind: 'notice.posted', key: 'appended', seq: lastRow + 1 });
    expect(push.mock.calls.length).toBe(lastRow + 1); // resumed where the first page stopped, the appended row included
    const again = await stream.snapshot(null, null);
    expect(again.events).toEqual([...first.events, ...rest.events]);
    expect(push.mock.calls.length).toBe(2 * (lastRow + 1)); // from the start: a fresh rebuild
  });

  it('a journal that can no longer be read answers what the ring holds, incomplete', async () => {
    const { events, launchId, sessionId, appSessionId } = await recordedInit();
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath: join(dir, 'gone', 'LAUNCHS1.jsonl'), emit: recorder().emit, ringSize: 5 });
    stream.events(events);
    const answer = await stream.snapshot(null, null);
    expect(answer.complete).toBe(false);
    expect(answer.events).toEqual(events.slice(-answer.events.length));
    expect(answer.events.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps each broker item\'s originating request event while the item is pending or delivered', async () => {
    const run = await replayedSession('pass1', 'permission-roundtrip', (row, { session, ready, fixture, transport }) => {
      const frame = row.frame as { type: string };
      if (frame.type === 'user' && row.seq === 4) void ready().then(() => session.send((fixture.find((r) => r.seq === 4)!.frame as { message: { content: string } }).message.content));
      else transport.kill('SIGTERM'); // at the answer the fixture recorded: the request stays pending, then the exit retires it
    });
    const requested = run.events.find((e) => e.kind === 'permission.requested')!;
    const stream = new SessionStream({ appSessionId: run.session.status().appSessionId, launchId: 'L', sessionId: null, journalPath: join(dir, 'L.jsonl'), emit: recorder().emit });
    stream.events(run.events);
    const requestId = (requested as { requestId: string }).requestId as never;
    const item = { id: 'a' as never, appSessionId: run.session.status().appSessionId, sessionId: null, kind: 'permission' as const, request: { requestId, toolUseId: null, taskId: null, agentId: null }, summary: 's', createdAt: 't', state: 'pending' as const, stateChangedAt: 't', expiresAt: null };
    stream.brokerItems([item]);
    expect(stream.pendingRequest(requestId)).toEqual(requested);
    stream.brokerItems([{ ...item, state: 'confirmed' }]);
    expect(stream.pendingRequest(requestId)).toBeNull();
    stream.brokerItems([]);
    expect(stream.pendingRequest(requestId)).toBeNull();
    expect(stream.pendingRequest('nope' as never)).toBeNull();
  });

  // E1 M5: a list published between a request's event and its item (a blocking `maws` ask opens its item after the
  // broker re-published for the same frame, which confirmed the call's permission) must not forget the event
  it('keeps a request event whose item has not been listed yet across an earlier list', async () => {
    const run = await replayedSession('pass1', 'permission-roundtrip', (row, { session, ready, fixture, transport }) => {
      const frame = row.frame as { type: string };
      if (frame.type === 'user' && row.seq === 4) void ready().then(() => session.send((fixture.find((r) => r.seq === 4)!.frame as { message: { content: string } }).message.content));
      else transport.kill('SIGTERM');
    });
    const requested = run.events.find((e) => e.kind === 'permission.requested')!;
    const stream = new SessionStream({ appSessionId: run.session.status().appSessionId, launchId: 'L', sessionId: null, journalPath: join(dir, 'L.jsonl'), emit: recorder().emit });
    stream.events(run.events);
    const requestId = (requested as { requestId: string }).requestId as never;
    stream.brokerItems([]);
    const item = { id: 'a' as never, appSessionId: run.session.status().appSessionId, sessionId: null, kind: 'permission' as const, request: { requestId, toolUseId: null, taskId: null, agentId: null }, summary: 's', createdAt: 't', state: 'pending' as const, stateChangedAt: 't', expiresAt: null };
    stream.brokerItems([item]);
    expect(stream.pendingRequest(requestId)).toEqual(requested);
    stream.brokerItems([]);
    expect(stream.pendingRequest(requestId)).toBeNull();
    stream.brokerItems([item]); // forgotten once its item left the list: a later listing finds nothing to answer
    expect(stream.pendingRequest(requestId)).toBeNull();
  });

  // E11 (tracker row E1 "stream keeps request events of never-listed items"): a request the broker retires without
  // listing it keeps no event. A later listing of the same id is the probe: an event still held would answer it.
  it('drops the event of a request the broker retired while the process was exiting, at the exit', async () => {
    const run = await replayedSession('pass1', 'permission-roundtrip', (row, { session, ready, fixture, transport }) => {
      const frame = row.frame as { type: string };
      if (frame.type === 'user' && row.seq === 4) void ready().then(() => session.send((fixture.find((r) => r.seq === 4)!.frame as { message: { content: string } }).message.content));
      else transport.kill('SIGTERM');
    });
    const requested = run.events.find((e) => e.kind === 'permission.requested')!;
    const status = run.session.status();
    const stream = new SessionStream({ appSessionId: status.appSessionId, launchId: 'L', sessionId: null, journalPath: join(dir, 'L.jsonl'), emit: recorder().emit });
    stream.events(run.events); // the broker retired it at its accept (the process exiting) and never listed it
    stream.status({ ...status, process: 'exited' });
    const requestId = (requested as { requestId: string }).requestId as never;
    stream.brokerItems([{ id: 'a' as never, appSessionId: status.appSessionId, sessionId: null, kind: 'permission' as const, request: { requestId, toolUseId: null, taskId: null, agentId: null }, summary: 's', createdAt: 't', state: 'pending' as const, stateChangedAt: 't', expiresAt: null }]);
    expect(stream.pendingRequest(requestId)).toBeNull();
  });

  it('keeps no event for a re-delivered request whose id the broker already retired', async () => {
    const run = await replayedSession('pass1', 'permission-roundtrip', (row, { session, ready, fixture, transport }) => {
      const frame = row.frame as { type: string };
      if (frame.type === 'user' && row.seq === 4) void ready().then(() => session.send((fixture.find((r) => r.seq === 4)!.frame as { message: { content: string } }).message.content));
      else transport.kill('SIGTERM');
    });
    const requested = run.events.find((e) => e.kind === 'permission.requested')!;
    const requestId = (requested as { requestId: string }).requestId as never;
    const retired = new Set<string>();
    const stream = new SessionStream({ appSessionId: run.session.status().appSessionId, launchId: 'L', sessionId: null, journalPath: join(dir, 'L.jsonl'), emit: recorder().emit, retired: (id) => retired.has(id) });
    const item = { id: 'a' as never, appSessionId: run.session.status().appSessionId, sessionId: null, kind: 'permission' as const, request: { requestId, toolUseId: null, taskId: null, agentId: null }, summary: 's', createdAt: 't', state: 'pending' as const, stateChangedAt: 't', expiresAt: null };
    stream.events([requested]);
    stream.brokerItems([item]);
    expect(stream.pendingRequest(requestId)).toEqual(requested);
    retired.add(requestId); // answered and retired: its item leaves the list, and its event with it
    stream.brokerItems([]);
    stream.events([requested]); // the engine delivers the same request id again; the broker ignores a retired id
    stream.brokerItems([item]);
    expect(stream.pendingRequest(requestId)).toBeNull();
  });
});

// C12 start: the exited-history cap (C12 execution document, M1 task 5)
describe('an exited stream keeps a bounded ring (C12)', () => {
  it('trims its ring to the exited size at the exit; a late read over the trimmed range answers from the journal, whole', async () => {
    const { events, launchId, sessionId, appSessionId, status, journalPath } = await recordedInit();
    const { emit } = recorder();
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit, exitedRingSize: 5 });
    stream.events(events);
    stream.status({ ...status, process: 'ready' });
    expect(events.length).toBeGreaterThan(20);
    stream.status({ ...status, process: 'exited' });
    expect(await stream.snapshot(null, null)).toEqual({ events, lastSeq: events.at(-1)!.seq, complete: true }); // rebuilt from the journal
    const inRing = events.at(-3)!.seq!;
    expect((await stream.snapshot(inRing, null)).events).toEqual(events.filter((e) => e.seq! > inRing));
    rmSync(journalPath); // what the ring alone still holds: the last five events, marked incomplete
    const kept = await stream.snapshot(null, null);
    expect(kept.complete).toBe(false);
    expect(kept.events).toEqual(events.slice(-5));
  });

  it('a live stream keeps its full ring', async () => {
    const { events, launchId, sessionId, appSessionId, status, journalPath } = await recordedInit();
    const { emit } = recorder();
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit, exitedRingSize: 5 });
    stream.events(events);
    stream.status({ ...status, process: 'ready' });
    rmSync(journalPath);
    expect(await stream.snapshot(null, null)).toEqual({ events, lastSeq: events.at(-1)!.seq, complete: true });
  });
});
// C12 end

// E10 start: the delivered cursor and the connect burst (E10 execution document, §Design 3 "The delivered cursor",
// Task 2.1). The fake client reports each emit written while connected and dropped while not, as the runtime's emit does.
describe('the delivered cursor and the connect burst (E10)', () => {
  const APP = 'app-burst' as AppSessionId;
  const row = (seq: number, i = 0): SessionEvent => ev('session.state', { id: `${APP}:L:${seq}:${i}`, sessionId: 'sess-burst', seq });
  const rows = (from: number, count: number): SessionEvent[] => Array.from({ length: count }, (_, k) => row(from + k));
  const CATALOG = { commands: [], agents: [], skills: [], terminalSlashCommands: [], revision: 1 };
  const STATE = { status: engineStatus(APP), queue: { entries: [], paused: false }, brokerItems: [], catalog: CATALOG };

  function client() {
    const emitted: Emitted[] = [];
    const state = { connected: true, writesLeft: Infinity, refuse: null as ((events: SessionEvent[]) => boolean) | null };
    const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => {
      const checked = validateEventPayload(name, payload);
      if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
      if (!state.connected || state.writesLeft <= 0) return false;
      if (name === 'session.eventBatch' && state.refuse?.((payload as { events: SessionEvent[] }).events)) return false; // the runtime's refusal of an invalid payload
      state.writesLeft -= 1;
      emitted.push({ name, payload });
      return true;
    };
    const batches = () => emitted.filter((e) => e.name === 'session.eventBatch').map((e) => (e.payload as { events: SessionEvent[] }).events.map((x) => x.id));
    const delivered = () => batches().flat();
    return { emitted, emit, state, batches, delivered };
  }

  function stream(emit: ReturnType<typeof client>['emit'], extra: { ringSize?: number; log?: (line: string) => void; hasClient?: () => boolean } = {}) {
    return new SessionStream({ appSessionId: APP, launchId: 'L', sessionId: null, journalPath: join(dir, 'L.jsonl'), emit, ...extra });
  }

  it('with no client nothing is delivered, and the ready that follows delivers the whole ring after the row’s state', async () => {
    vi.useFakeTimers();
    const fake = client();
    fake.state.connected = false;
    const s = stream(fake.emit);
    s.events(rows(1, 3));
    await vi.advanceTimersByTimeAsync(16);
    expect(s.delivered).toBeNull();
    fake.state.connected = true;
    s.republish(STATE);
    expect(fake.emitted.map((e) => e.name)).toEqual(['session.status', 'session.queue', 'session.brokerItems', 'session.catalogChanged', 'session.eventBatch']);
    expect(fake.emitted[3]!.payload).toEqual({ appSessionId: APP, launchId: 'L', catalog: CATALOG });
    expect(fake.delivered()).toEqual(rows(1, 3).map((e) => e.id));
    expect(s.delivered).toEqual({ index: 2, id: `${APP}:L:3:0` });
  });

  it('publishes no queue for a queue not yet recovered and no catalog before the first one', () => {
    const fake = client();
    const s = stream(fake.emit);
    s.republish({ ...STATE, queue: null, catalog: null });
    expect(fake.emitted.map((e) => e.name)).toEqual(['session.status', 'session.brokerItems']);
  });

  it('a ready after partial delivery delivers only the tail; a row split across two live batches is delivered exactly once', async () => {
    vi.useFakeTimers();
    const fake = client();
    const s = stream(fake.emit);
    // 600 events, the 500th and 501st one row (seq 500), so the live batch at 500 splits it
    const many = [...rows(1, 499), row(500, 0), row(500, 1), ...rows(501, 99)];
    s.events(many);
    expect(fake.batches().map((b) => b.length)).toEqual([500]);
    fake.state.connected = false;
    await vi.advanceTimersByTimeAsync(16); // the rest, dropped
    s.events(rows(600, 50)); // and more while no client is connected
    await vi.advanceTimersByTimeAsync(16);
    fake.state.connected = true;
    s.republish(STATE);
    expect(fake.batches().map((b) => b.length)).toEqual([500, 150]);
    expect(fake.delivered()).toEqual([...many, ...rows(600, 50)].map((e) => e.id)); // once each, in order
  });

  it('a trim after delivery moves the cursor with the ring: the ready delivers exactly the tail', () => {
    const fake = client();
    const s = stream(fake.emit, { ringSize: 10 });
    s.events(rows(1, 8));
    s.flush();
    expect(s.delivered).toEqual({ index: 7, id: `${APP}:L:8:0` });
    fake.state.connected = false;
    s.events(rows(9, 5)); // 13 events: past the ring's slack, trimmed to the last 10
    expect(s.delivered).toEqual({ index: 4, id: `${APP}:L:8:0` });
    fake.state.connected = true;
    s.republish(STATE);
    expect(fake.batches().at(-1)).toEqual(rows(9, 5).map((e) => e.id));
  });

  it('events pending in the batch window at ready are delivered once, by the burst', async () => {
    vi.useFakeTimers();
    const fake = client();
    const s = stream(fake.emit);
    s.events(rows(1, 2));
    s.flush();
    s.events(rows(3, 3)); // pending, the timer armed
    s.republish(STATE);
    await vi.advanceTimersByTimeAsync(50);
    expect(fake.delivered()).toEqual(rows(1, 5).map((e) => e.id));
    expect(fake.emitted.at(-1)!.name).toBe('session.eventBatch'); // the burst's; the timer sent nothing after it
    expect(fake.batches()).toHaveLength(2);
  });

  it('a ring that rolled past the cursor logs tail_gap with the ids and delivers what it holds', () => {
    const fake = client();
    const lines: string[] = [];
    const s = stream(fake.emit, { ringSize: 10, log: (line) => lines.push(line) });
    s.events(rows(1, 2));
    s.flush();
    fake.state.connected = false;
    s.events(rows(3, 20)); // 22 events: trimmed to the last 10, past the delivered one
    expect(s.delivered).toBeNull();
    fake.state.connected = true;
    s.republish(STATE);
    expect(fake.batches().at(-1)).toEqual(rows(13, 10).map((e) => e.id));
    expect(lines).toEqual([expect.stringContaining('tail_gap')]);
    expect(lines[0]).toContain(`${APP}:L:3:0`); // the first event lost to the client
    expect(lines[0]).toContain(`${APP}:L:12:0`); // and the last
    s.republish(STATE);
    expect(lines).toHaveLength(1); // logged once
  });

  it('a second ready delivers nothing twice, and nothing the burst delivered is flushed again', async () => {
    vi.useFakeTimers();
    const fake = client();
    const s = stream(fake.emit);
    fake.state.connected = false;
    s.events(rows(1, 4));
    fake.state.connected = true;
    s.republish(STATE);
    s.republish(STATE);
    await vi.advanceTimersByTimeAsync(50);
    s.flush();
    expect(fake.batches()).toEqual([rows(1, 4).map((e) => e.id)]);
    s.events(rows(5, 1));
    s.flush();
    expect(fake.delivered()).toEqual(rows(1, 5).map((e) => e.id));
  });

  it('a client lost during the burst keeps the cursor at the last batch written; the next ready sends the rest', () => {
    const fake = client();
    const s = stream(fake.emit, { hasClient: () => fake.state.connected && fake.state.writesLeft > 0 });
    fake.state.connected = false;
    s.events(rows(1, 1_200));
    s.flush();
    fake.state.connected = true;
    fake.state.writesLeft = 4 + 1; // the row's four state events and one batch
    s.republish(STATE);
    expect(fake.batches().map((b) => b.length)).toEqual([500]);
    expect(s.delivered).toEqual({ index: 499, id: `${APP}:L:500:0` });
    fake.state.writesLeft = Infinity;
    s.republish(STATE);
    expect(fake.batches().map((b) => b.length)).toEqual([500, 500, 200]);
    expect(fake.delivered()).toEqual(rows(1, 1_200).map((e) => e.id));
  });

  // Task 2.1's review: the runtime answers false for an invalid payload as well as for a client gone; a refused batch
  // with the client still there is skipped, or one bad event would strand the rest of the row's tail at every connect
  it('a batch refused while the client stays connected is skipped with a log line, and the rest of the tail still goes', () => {
    const fake = client();
    const lines: string[] = [];
    const s = stream(fake.emit, { log: (line) => lines.push(line), hasClient: () => fake.state.connected });
    fake.state.connected = false;
    s.events(rows(1, 1_200));
    s.flush();
    fake.state.connected = true;
    fake.state.refuse = (events) => events.some((e) => e.id === `${APP}:L:700:0`);
    s.republish(STATE);
    expect(fake.batches().map((b) => b.length)).toEqual([500, 200]); // 501..1000 refused
    expect(fake.delivered()).toEqual([...rows(1, 500), ...rows(1_001, 200)].map((e) => e.id));
    expect(lines).toEqual([expect.stringContaining(`refused a batch of 500 (${APP}:L:501:0 .. ${APP}:L:1000:0)`)]);
    expect(s.delivered).toEqual({ index: 1_199, id: `${APP}:L:1200:0` });
    s.republish(STATE);
    expect(fake.batches()).toHaveLength(2); // nothing resent
  });

  it('a live batch refused while the client stays connected moves the cursor past it, so no burst resends it', () => {
    const fake = client();
    const s = stream(fake.emit, { log: () => {}, hasClient: () => fake.state.connected });
    fake.state.refuse = (events) => events.some((e) => e.id === `${APP}:L:2:0`);
    s.events(rows(1, 3));
    s.flush();
    expect(s.delivered).toEqual({ index: 2, id: `${APP}:L:3:0` });
    fake.state.refuse = null;
    s.republish(STATE);
    expect(fake.batches()).toEqual([]);
  });
});
// E10 end
