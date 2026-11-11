import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { deserialize, serialize } from 'node:v8'; // P5 O15 M2b (§L)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { AttentionItem } from '@shared/graph/attention'; // P5 O16 M3c fix wave 1
import type { EngineSessionStatus } from '@shared/engine/status';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { replayedSession } from './conformance/session-harness';
import type { EngineSession } from './session'; // P5 O15 M2b (§L)
import { parseStdoutLine, type EngineTransport } from './transport'; // P5 O15 M2b (Decision Log 30)
import { JOURNAL_MAX_BYTES, JournalReader, JournalWriter } from './journal';
import { Normalizer } from './normalizer';
import { BATCH_BYTES, CHECKPOINT_BYTES, CHECKPOINT_SPARSE_EVERY, CHECKPOINTS_DENSE, CHECKPOINTS_MAX, SessionStream, type Checkpoint } from './session-stream';
import type { NormalizerState } from './normalizer'; // P5 O15 M2b (§L)
import { loadJournal, type FixturePass } from '../../test/support/fixtures'; // P5 O15 M2b (§L)
import { ARTIFACT_SCREENSHOT_MAX_BYTES as SCREENSHOT_MAX_BYTES } from '@shared/maws/tools'; // E11: A-34's image cap
import { LINE_CAP } from '@shared/host/socket-protocol'; // E11
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
// writer, and the events it produced. P5 O15 M2b (§L): `live` gives the session a checkpoint interval and takes what
// it hands its stream; `maxBytes` the writer's rotation size; `beforeSend` acts on the ready session before the turn;
// `wrap` stands between the replay and the session (Decision Log 30: an engine line rewritten); `log` the session's.
async function recordedInit(live: { checkpointRows: number; maxBytes: number; checkpoint: (c: Checkpoint) => void; beforeSend?: (session: EngineSession) => void; wrap?: (t: EngineTransport) => EngineTransport; log?: (message: string) => void } | null = null): Promise<{ events: SessionEvent[]; launchId: string; sessionId: string; appSessionId: AppSessionId; status: EngineSessionStatus; journalPath: string }> {
  const writer = new JournalWriter(dir, 'LAUNCHS1', { maxBytes: live?.maxBytes ?? JOURNAL_MAX_BYTES });
  const run = await replayedSession('pass1', 'reads', (row, { session, ready, fixture, transport }) => {
    const frame = row.frame as { type: string };
    if (frame.type === 'user') {
      void ready().then(() => {
        live?.beforeSend?.(session);
        return session.send((fixture.find((r) => r.seq === row.seq)!.frame as { message: { content: string } }).message.content);
      });
    } else transport.kill('SIGTERM');
  }, {
    session: { journal: writer, ...(live && { checkpointRows: live.checkpointRows }), ...(live?.log && { log: live.log }) },
    ...(live?.wrap && { wrap: live.wrap }),
    beforeStart: (o) => {
      if (live) o.session.on('checkpoint', live.checkpoint);
    },
  });
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

  // P5 O16 M3c: an adopted launch's stream starts at the adoption (the successor's fold tells nothing), so what the
  // launch journaled before it is the journal's to answer, as an evicted range is
  it('an adopted launch answers what was journaled before its stream from the journal, and what came after from the ring', async () => {
    const { events, launchId, sessionId, appSessionId, journalPath } = await recordedInit();
    const split = Math.floor(events.length / 2);
    const through = events[split - 1]!.seq!;
    const after = events.filter((e) => e.seq! > through);
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, historyThrough: through });
    stream.events(after);
    stream.flush();
    expect(await stream.snapshot(null, null), 'the whole launch').toEqual({ events, lastSeq: events.at(-1)!.seq, complete: true });
    expect((await stream.snapshot(through, null)).events, 'after the adoption: the ring').toEqual(after);
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
    // every row normalised at most once over all the pages: the journal's pages read up to the rows the ring still holds,
    // which the last pages serve from the ring (P5 O7 M10's follow-up: where that boundary falls moves with the events a
    // row yields, a thinking block's start among them)
    const read = push.mock.calls.map(([row]) => row.seq);
    expect(new Set(read).size).toBe(read.length);
    expect(read.length).toBeLessThanOrEqual(rows);
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

  // P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, acceptance 12): a live page within a byte budget,
  // the answer's UTF-8 JSON, whole rows while they fit; `lastSeq` reaches the rest, and a row alone past it is left out,
  // said, and stepped over
  it('a byte budget pages whole rows within it from the ring and from the journal, each answer within it, stepping over a row alone past it', async () => {
    const { events, launchId, sessionId, appSessionId, journalPath } = await recordedInit();
    const maxBytes = 4096;
    const bytesOf = (answer: object) => Buffer.byteLength(JSON.stringify(answer));
    for (const ringSize of [undefined, 5]) {
      const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, ...(ringSize && { ringSize }) });
      stream.events(events);
      stream.flush();
      const pages = [await stream.snapshot(null, null, maxBytes)];
      while (!pages.at(-1)!.complete) pages.push(await stream.snapshot(pages.at(-1)!.lastSeq, null, maxBytes));
      for (const page of pages) expect(bytesOf(page), `ring ${ringSize ?? 'whole'}`).toBeLessThanOrEqual(maxBytes);
      expect(pages.length).toBeGreaterThan(3);
      const left = new Set(pages.flatMap((page) => (page.omitted ? [page.omitted.seq] : [])));
      for (const page of pages.filter((p) => p.omitted)) {
        expect(page.events).toEqual([]);
        expect(page.lastSeq).toBe(page.omitted!.seq);
        expect(page.omitted!.events).toBe(events.filter((e) => e.seq === page.omitted!.seq).length);
      }
      expect(pages.flatMap((page) => page.events)).toEqual(events.filter((e) => !left.has(e.seq))); // no row split, lost or repeated
      for (const page of pages.slice(0, -1)) expect(page.events.at(-1)?.seq ?? page.lastSeq).toBe(page.lastSeq);
    }
  });

  it('a byte budget leaves out a row alone past it with its seq and size, and the next page goes on after it', async () => {
    const stream = new SessionStream({ appSessionId: 'app-b' as AppSessionId, launchId: 'L', sessionId: null, journalPath: join(dir, 'none.jsonl'), emit: recorder().emit });
    const small = ev('notice.posted', { seq: 1, text: 'first' });
    const huge = ev('notice.posted', { seq: 2, text: '가'.repeat(2000) }); // 6 KB of UTF-8, 2 K characters of JSON
    const after = [ev('notice.posted', { seq: 3, text: 'third' }), ev('notice.posted', { seq: 3, text: 'third, its second event' })];
    stream.events([small, huge, ...after]);
    expect(await stream.snapshot(null, null, 4096)).toEqual({ events: [small], lastSeq: 1, complete: false });
    expect(await stream.snapshot(1, null, 4096)).toEqual({ events: [], lastSeq: 2, complete: false, omitted: { events: 1, bytes: Buffer.byteLength(JSON.stringify(huge)), seq: 2 } });
    expect(await stream.snapshot(2, null, 4096)).toEqual({ events: after, lastSeq: 3, complete: true });
    expect(await stream.snapshot(null, null)).toEqual({ events: [small, huge, ...after], lastSeq: 3, complete: true }); // unbounded, as before
  });

  it('a journal that can no longer be read answers what the ring holds, incomplete', async () => {
    const { events, launchId, sessionId, appSessionId } = await recordedInit();
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath: join(dir, 'gone', 'LAUNCHS1.jsonl'), emit: recorder().emit, ringSize: 5 });
    stream.events(events);
    const answer = await stream.snapshot(null, null);
    expect(answer.complete).toBe(false);
    expect(answer.events).toEqual(events.slice(-answer.events.length));
    expect(answer.events.length).toBeGreaterThanOrEqual(5);
    // O10 M8: and says the range it was asked for is not all there, apart from `complete` (a page's limit sets that too).
    expect(answer.historyUnavailable).toBe(true);
    const limited = await stream.snapshot(null, 2);
    expect(limited).toMatchObject({ complete: false, historyUnavailable: true });
    // A read the ring covers whole is whole, the journal lost or not.
    const covered = await stream.snapshot(answer.events.at(-2)!.seq!, null);
    expect(covered.historyUnavailable).toBeUndefined();
  });

  it('marks no answer `historyUnavailable` while the journal reads back, a page cut by its limit included (O10 M8)', async () => {
    const { events, launchId, sessionId, appSessionId, journalPath } = await recordedInit();
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, ringSize: 5 });
    stream.events(events);
    const page = await stream.snapshot(null, 2);
    expect(page.complete).toBe(false);
    expect(page.historyUnavailable).toBeUndefined();
    expect((await stream.snapshot(null, null)).historyUnavailable).toBeUndefined();
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
  // P5 O16 M3c fix wave 1: an adopted launch's restored item, whose event the stream never saw, from its fold's read
  it('answers a live item it never saw the event of from `restored`, and nothing once the item has left the list', async () => {
    const { launchId, sessionId, appSessionId, journalPath } = await recordedInit();
    const restoredEvent = { kind: 'permission.requested', requestId: 'rq-restored' } as unknown as SessionEvent;
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, restored: (id) => (id === 'rq-restored' ? restoredEvent : null) });
    expect(stream.pendingRequest('rq-restored' as RequestId), 'not a live item yet').toBeNull();
    const item: AttentionItem = { id: 'a' as never, appSessionId, sessionId: null, kind: 'permission', request: { requestId: 'rq-restored' as RequestId, toolUseId: null, taskId: null, agentId: null }, summary: 's', createdAt: 't', state: 'pending', stateChangedAt: 't', expiresAt: null };
    stream.brokerItems([item]);
    expect(stream.pendingRequest('rq-restored' as RequestId)).toBe(restoredEvent);
    stream.brokerItems([]);
    expect(stream.pendingRequest('rq-restored' as RequestId)).toBeNull();
  });

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

// P5 O15 M2b (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, §H): host.log says when a launch's ring first
// evicted, and when a read was served from the journal that does not continue the page before it, with the rows it read.
describe('what host.log says of the ring and the journal (P5 O15 M2b)', () => {
  const evictions = (lines: string[]) => lines.filter((line) => line.startsWith('ring evicted '));
  const journalReads = (lines: string[]) => lines.filter((line) => line.startsWith('session.events '));

  it('names a launch\'s first eviction once, whatever the count of trims, the exit\'s included', async () => {
    const { events, launchId, sessionId, appSessionId, status, journalPath } = await recordedInit();
    const lines: string[] = [];
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, ringSize: 5, exitedRingSize: 2, log: (line) => lines.push(line) });
    stream.events(events.slice(0, 6));
    expect(evictions(lines), 'nothing evicted yet').toEqual([]);
    for (const event of events.slice(6)) stream.events([event]); // a trim every few events
    stream.status({ ...status, process: 'exited' });
    const firstDropped = events[1]!.seq; // the first trim, at the seventh event, keeps the newest 5
    expect(evictions(lines)).toEqual([`ring evicted ${appSessionId} launch ${launchId}: events through seq ${firstDropped} are the journal's now`]);
  });

  it('says nothing of an eviction for an adopted launch\'s history, which the ring never held', async () => {
    const { events, launchId, sessionId, appSessionId, journalPath } = await recordedInit();
    const lines: string[] = [];
    const through = events[Math.floor(events.length / 2)]!.seq!;
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, historyThrough: through, log: (line) => lines.push(line) });
    stream.events(events.filter((e) => e.seq! > through));
    expect(evictions(lines)).toEqual([]);
  });

  it('names a journal read at its first page with the rows it read, not at the pages that continue it, and again at a read that starts over', async () => {
    const { events, launchId, sessionId, appSessionId, journalPath } = await recordedInit();
    const lines: string[] = [];
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, ringSize: 5, log: (line) => lines.push(line) });
    stream.events(events);
    stream.flush();
    const push = vi.spyOn(Normalizer.prototype, 'push');
    const first = await stream.snapshot(null, 5);
    const firstRows = push.mock.calls.length;
    expect(firstRows).toBeGreaterThan(0);
    expect(journalReads(lines)).toHaveLength(1);
    expect(journalReads(lines)[0]).toMatch(new RegExp(`^session\\.events ${appSessionId} after start: from the journal, ${firstRows} rows read in \\d+ ms$`));
    const pages = [first];
    while (!pages.at(-1)!.complete) pages.push(await stream.snapshot(pages.at(-1)!.lastSeq, 5));
    expect(pages.length).toBeGreaterThan(3);
    expect(journalReads(lines), 'the pages that continue it').toHaveLength(1);

    push.mockClear();
    const from = events[2]!.seq!;
    await stream.snapshot(from, 5); // not the last page's cursor: the journal is read from its first row again
    expect(journalReads(lines)).toHaveLength(2);
    expect(journalReads(lines)[1]).toMatch(new RegExp(`^session\\.events ${appSessionId} after ${from}: from the journal, ${push.mock.calls.length} rows read in \\d+ ms$`));
  });

  it('says nothing of a read the ring serves, or of one the journal cannot serve', async () => {
    const { events, launchId, sessionId, appSessionId } = await recordedInit();
    const lines: string[] = [];
    const stream = new SessionStream({ appSessionId, launchId, sessionId: sessionId as never, journalPath: join(dir, 'gone', 'LAUNCHS1.jsonl'), emit: recorder().emit, ringSize: 5, log: (line) => lines.push(line) });
    stream.events(events);
    stream.flush();
    await stream.snapshot(events.at(-2)!.seq!, null); // inside the ring
    expect((await stream.snapshot(null, null)).historyUnavailable).toBe(true); // the journal is gone: the ring answers
    expect(journalReads(lines)).toEqual([]);
  });
});

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
    const gaps = () => lines.filter((line) => !line.startsWith('ring evicted ')); // P5 O15 M2b: the first eviction has its own line
    expect(gaps()).toEqual([expect.stringContaining('tail_gap')]);
    expect(gaps()[0]).toContain(`${APP}:L:3:0`); // the first event lost to the client
    expect(gaps()[0]).toContain(`${APP}:L:12:0`); // and the last
    s.republish(STATE);
    expect(gaps()).toHaveLength(1); // logged once
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

  // E11 scale review A sweep#1: inline screenshots ride the events as base64, so 500 of them can pass the socket's line
  // cap; main then drops the connection while the cursor has already moved past the batch
  it('cuts the burst by bytes as well as by count, so no batch line nears the socket line cap', () => {
    const fake = client();
    const s = stream(fake.emit);
    fake.state.connected = false;
    const data = 'A'.repeat(Math.ceil((SCREENSHOT_MAX_BYTES * 4) / 3)); // one screenshot at the cap, as base64
    const shot = (seq: number): SessionEvent =>
      ev('tool.result', { id: `${APP}:L:${seq}:0`, sessionId: 'sess-burst', seq, toolUseId: `toolu_${seq}`, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] });
    const tail = [...rows(1, 3), ...Array.from({ length: 20 }, (_, k) => shot(4 + k)), ...rows(24, 3)];
    s.events(tail);
    s.flush();
    fake.state.connected = true;
    s.republish(STATE);
    const lines = fake.emitted.filter((e) => e.name === 'session.eventBatch').map((e) => Buffer.byteLength(JSON.stringify({ t: 'evt', name: e.name, payload: e.payload })));
    expect(lines.length).toBeGreaterThan(1);
    for (const bytes of lines) expect(bytes).toBeLessThanOrEqual(BATCH_BYTES + 1024); // the batch's events plus the envelope
    expect(BATCH_BYTES).toBeLessThanOrEqual(LINE_CAP / 4);
    expect(fake.delivered()).toEqual(tail.map((e) => e.id)); // once each, in order
    expect(s.delivered).toEqual({ index: tail.length - 1, id: tail.at(-1)!.id });
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

// P5 O15 M2b Task 8 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, §L): checkpoints in the stream. A journal
// read that cannot go on from its page cursor starts at the newest checkpoint at or before its cursor, and every answer
// is the one a stream with no checkpoint gives, event for event; host.log's journal line names the checkpoint and the
// rows read from it.
describe('checkpoints: a journal read starts near its cursor and answers as the full re-read does (P5 O15 M2b, §L)', () => {
  const NONE = Number.POSITIVE_INFINITY; // an interval no row's seq is a multiple of: a stream that takes no checkpoint
  const APP_CP = 'app-cp' as AppSessionId;
  const LAUNCH_CP = 'LAUNCHCP';
  const ROTATE_BYTES = 128 * 1024;
  // objects shaped like an encoding's tags, in tool uses' inputs (returned in events) and in a control request the
  // normaliser holds open across most of the journal (kept in its state)
  const TAGGED = { $map: [['k', 1], ['m', { $set: [1, 2] }]], $set: ['a', { $map: [] }] };

  interface Shaped {
    journalPath: string;
    lastSeq: number;
    files: string[];
  }

  // A journal shaped from the probe's recordings: launches of pass 1 and pass 2 one after another, renumbered by the
  // production writer at a small rotation size. Every other streamed block event loses its `index`, so the normaliser
  // keeps a NaN for the blocks they start (`Number(event.index)`).
  function shapedJournal(): Shaped {
    const writer = new JournalWriter(dir, LAUNCH_CP, { maxBytes: ROTATE_BYTES });
    const recordings: [FixturePass, string][] = [
      ['pass1', 'subagent'], ['pass1', 'permission-roundtrip'], ['pass1', 'queue-and-interrupt'],
      ['pass1', 'question-roundtrip'], ['pass2', 'rewind'], ['pass2', 'dialogs'], ['pass1', 'subagent'],
    ];
    let blockEvents = 0;
    writer.row('out', { type: 'control_request', request_id: 'tagged-open', request: { subtype: 'tagged_probe', payload: TAGGED } });
    recordings.forEach(([pass, name], n) => {
      for (const row of loadJournal(pass, name)) {
        const frame = structuredClone(row.frame) as { type?: string; event?: { type?: unknown; index?: number }; message?: { content?: unknown } };
        const { event } = frame;
        if (frame.type === 'stream_event' && event !== undefined && typeof event.type === 'string' && event.type.startsWith('content_block_') && blockEvents++ % 2 === 0) delete event.index;
        const content = frame.message?.content;
        if (frame.type === 'assistant' && Array.isArray(content)) {
          for (const block of content as { type?: string; input?: Record<string, unknown> }[]) if (block.type === 'tool_use') block.input = { ...block.input, ...TAGGED };
        }
        writer.row(row.direction, frame);
      }
      if (n === recordings.length - 2) writer.row('in', { type: 'control_response', response: { subtype: 'success', request_id: 'tagged-open', response: {} } });
    });
    void writer.close();
    return { journalPath: writer.path, lastSeq: writer.lastSeq, files: JournalReader.forSession(dir) };
  }

  const streamOn = (journal: Shaped, checkpointRows: number, lines?: string[]) =>
    new SessionStream({ appSessionId: APP_CP, launchId: LAUNCH_CP, sessionId: null, journalPath: journal.journalPath, emit: recorder().emit, historyThrough: journal.lastSeq, checkpointRows, ...(lines && { log: (line: string) => lines.push(line) }) });

  const journalLines = (lines: string[]) => lines.filter((line) => line.startsWith('session.events '));
  const journalLine = /^session\.events \S+ after (\d+|start): from the journal, (\d+) rows read in \d+ ms(?:, from the checkpoint at seq (\d+))?$/;
  const readOf = (line: string) => {
    const m = journalLine.exec(line);
    if (!m) throw new Error(`not a journal line: ${line}`);
    return { rows: Number(m[2]), from: m[3] === undefined ? null : Number(m[3]) };
  };

  // mulberry32: the same cursors on every run
  function random(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const nanIndexed = (state: NormalizerState) => [...state.streaming.values()].some((lane) => lane.started.some((s) => Number.isNaN(s.index)));

  it('answers every read, and the pages after it, event for event as a stream with no checkpoint, at random cursors', async () => {
    const journal = shapedJournal();
    expect(journal.files.length, 'the journal rotated').toBeGreaterThanOrEqual(3);
    const taken = vi.spyOn(SessionStream.prototype, 'checkpoint');
    const rand = random(0x0515);
    const lines: string[] = [];
    let compared = 0;
    for (const every of [25, 7, 1]) {
      for (let trial = 0; trial < 8; trial += 1) {
        const a = streamOn(journal, every, lines);
        const b = streamOn(journal, NONE);
        if (trial % 2 === 1) expect(await a.snapshot(null, null)).toStrictEqual(await b.snapshot(null, null)); // a first scan from the start, or none
        for (let read = 0; read < 8; read += 1) {
          const afterSeq = rand() < 0.1 ? null : Math.floor(rand() * (journal.lastSeq + 2));
          const limit = rand() < 0.3 ? null : 1 + Math.floor(rand() * 60);
          const maxBytes = rand() < 0.7 ? null : 2_048 + Math.floor(rand() * 64 * 1024);
          let cursor = afterSeq;
          for (let page = 0; page < 4; page += 1) {
            const [pa, pb] = [await a.snapshot(cursor, limit, maxBytes), await b.snapshot(cursor, limit, maxBytes)];
            expect(pa, `every ${every}, trial ${trial}, after ${cursor} (from ${afterSeq}), limit ${limit}, ${maxBytes} bytes`).toStrictEqual(pb);
            compared += 1;
            if (pb.complete) break;
            cursor = pb.lastSeq;
          }
        }
        a.dispose();
        b.dispose();
      }
    }
    expect(compared).toBeGreaterThan(200);
    // what the property was exercised on: reads that began at a checkpoint, states at boundaries that hold a NaN and the tags
    expect(journalLines(lines).filter((line) => readOf(line).from !== null).length, 'reads from a checkpoint').toBeGreaterThan(10);
    const states = taken.mock.calls.map(([c]) => c.state);
    expect(states.some((state) => nanIndexed(deserialize(state) as NormalizerState)), 'a NaN in a state at a boundary').toBe(true);
    expect(states.some((state) => state.includes('$map') && state.includes('$set')), 'the tags in a state at a boundary').toBe(true);
  }, 60_000);

  // The rule as §L states it, applied at each checkpoint handed over in order: the throughs and sizes it keeps.
  function rule(handed: readonly Checkpoint[], every: number): { through: number; bytes: number }[] {
    let held: { through: number; bytes: number }[] = [];
    for (const c of handed) {
      if (held.some((h) => h.through === c.through)) continue;
      held.push({ through: c.through, bytes: c.state.length });
      held.sort((x, y) => x.through - y.through);
      const head = held.at(-1)!.through / every;
      held = held.filter((h) => head - h.through / every < CHECKPOINTS_DENSE || (h.through / every) % CHECKPOINT_SPARSE_EVERY === 0);
      while (held.length > CHECKPOINTS_MAX || held.reduce((n, h) => n + h.bytes, 0) > CHECKPOINT_BYTES) held.shift();
    }
    return held;
  }

  // Every checkpoint a scan from the first row takes, in order (through the stream's own `checkpoint`).
  async function scanned(journal: Shaped, every: number): Promise<{ checkpoints: Checkpoint[]; lastSeq: number }> {
    const taken = vi.spyOn(SessionStream.prototype, 'checkpoint');
    const { lastSeq } = await streamOn(journal, every).snapshot(null, null);
    const checkpoints = taken.mock.calls.map(([c]) => c);
    taken.mockRestore();
    return { checkpoints, lastSeq };
  }

  // A stream that holds what the rule keeps of `handed` and has read nothing yet, so its first read cannot go on from a page.
  function holding(journal: Shaped, every: number, handed: readonly Checkpoint[], lines: string[]): SessionStream {
    const stream = streamOn(journal, every, lines);
    for (const c of handed) stream.checkpoint(c);
    return stream;
  }

  // The one journal line a read wrote.
  async function readWith(stream: SessionStream, lines: string[], afterSeq: number, limit: number) {
    lines.length = 0;
    const answer = await stream.snapshot(afterSeq, limit);
    const read = journalLines(lines);
    expect(read, `one journal line for the read after ${afterSeq}`).toHaveLength(1);
    return { answer, ...readOf(read[0]!) };
  }

  it('reads, for a cursor in the dense region, the rows from the checkpoint before it and the page: the count host.log carries', async () => {
    const journal = shapedJournal();
    const every = 25;
    const { checkpoints, lastSeq } = await scanned(journal, every);
    const head = Math.floor(journal.lastSeq / every);
    const dense = (head - CHECKPOINTS_DENSE + 1) * every; // the oldest boundary of the dense region
    expect(rule(checkpoints, every)[0]!.through).toBeLessThanOrEqual(dense);
    const rand = random(0x2b);
    const cursors = [lastSeq - 1, dense + every - 1, dense, ...Array.from({ length: 12 }, () => dense + Math.floor(rand() * (lastSeq - dense)))];
    const push = vi.spyOn(Normalizer.prototype, 'push');
    let tagged = 0;
    const la: string[] = [];
    const lb: string[] = [];
    for (const cursor of cursors) {
      const a = holding(journal, every, checkpoints, la);
      push.mockClear();
      const ra = await readWith(a, la, cursor, 20);
      const pushed = push.mock.calls.length;
      const rb = await readWith(streamOn(journal, NONE, lb), lb, cursor, 20);
      expect(ra.answer, `after ${cursor}`).toStrictEqual(rb.answer);
      if (JSON.stringify(ra.answer.events).includes('"$map"')) tagged += 1;
      const from = Math.floor(cursor / every) * every;
      expect(ra.from, `after ${cursor}`).toBe(from);
      expect(rb.from).toBeNull();
      expect(ra.rows, 'the line counts the rows normalised').toBe(pushed);
      // today's read went from the first row to where this one stopped; this one from the checkpoint, under one interval
      // before the cursor, and the page's rows after it
      expect(ra.rows).toBe(rb.rows - from);
      expect(cursor - from).toBeLessThan(every);
      expect(ra.rows).toBeLessThanOrEqual(every + (rb.rows - cursor));
    }
    expect(tagged, 'reads through a checkpoint returned the tagged payloads').toBeGreaterThan(0);
  });

  it('a read past the rows its kept page cursor has read starts at the checkpoint instead, and the page after it goes on', async () => {
    const journal = shapedJournal();
    const every = 25;
    const { checkpoints } = await scanned(journal, every);
    const lines: string[] = [];
    const a = holding(journal, every, checkpoints, lines);
    const early = await readWith(a, lines, 10, 5); // a kept cursor near the start
    expect(early.from).toBeNull();
    const cursor = journal.lastSeq - 100; // past it: going on from it would read every row between
    const jump = await readWith(a, lines, cursor, 5);
    expect(jump.from).toBe(Math.floor(cursor / every) * every);
    expect(jump.rows).toBeLessThan(every + 100);
    lines.length = 0;
    const push = vi.spyOn(Normalizer.prototype, 'push');
    const next = await a.snapshot(jump.answer.lastSeq, 5);
    expect(journalLines(lines), 'the page after it goes on from its cursor').toEqual([]);
    expect(push.mock.calls.every(([row]) => row.seq > jump.answer.lastSeq)).toBe(true);
    expect(next).toStrictEqual(await streamOn(journal, NONE).snapshot(jump.answer.lastSeq, 5));
  });

  it('a checkpoint the live path took is, byte for byte, the one a scan takes at the same row, and reads from it answer as today', async () => {
    const live: Checkpoint[] = [];
    const every = 3;
    const { events, launchId, sessionId, appSessionId, journalPath } = await recordedInit({ checkpointRows: every, maxBytes: 4 * 1024, checkpoint: (c) => live.push(c) });
    const files = JournalReader.forSession(dir);
    const lastSeq = Number((JSON.parse(readFileSync(files.at(-1)!, 'utf8').trim().split('\n').at(-1)!) as { seq: number }).seq);
    expect(live.map((c) => c.through), 'one at each boundary row').toEqual(Array.from({ length: Math.floor(lastSeq / every) }, (_, k) => (k + 1) * every));
    expect(new Set(live.map((c) => c.index)).size, 'checkpoints in several of the launch\'s files').toBeGreaterThan(1);
    const options = { appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, historyThrough: lastSeq };
    const taken = vi.spyOn(SessionStream.prototype, 'checkpoint');
    await new SessionStream({ ...options, checkpointRows: every }).snapshot(null, null);
    const scan = new Map(taken.mock.calls.map(([c]) => [c.through, c]));
    taken.mockRestore();
    for (const c of live) {
      const s = scan.get(c.through);
      expect(s, `the scan's at seq ${c.through}`).toBeDefined();
      expect({ ...s!, state: null }).toEqual({ ...c, state: null });
      expect(s!.state.equals(c.state), `the states at seq ${c.through}`).toBe(true);
    }
    const lines: string[] = [];
    const fed = new SessionStream({ ...options, checkpointRows: every, log: (line) => lines.push(line) });
    for (const c of live) fed.checkpoint(c);
    const today = new SessionStream({ ...options, checkpointRows: NONE });
    for (let cursor = lastSeq; cursor >= 0; cursor -= 1) expect(await fed.snapshot(cursor, null), `after ${cursor}`).toStrictEqual(await today.snapshot(cursor, null));
    expect(journalLines(lines).filter((line) => readOf(line).from !== null).length, 'reads from the live path\'s checkpoints').toBeGreaterThan(0);
    expect((await fed.snapshot(null, null)).events).toEqual(events);
  });

  // Decision Log 29 (a): the host builds a control request as `{ subtype, ...payload }` (rpc.ts), so a payload member
  // that is undefined is in the live normaliser's `outbound` entry until the answer, and not in the journal's JSON: the
  // live checkpoint's bytes then differ from a scan's at that row, and a read on from it must still answer as today.
  it('a live checkpoint that holds an undefined member the journal drops keeps it, and reads on from it as a full scan does', async () => {
    const live: Checkpoint[] = [];
    const { events, launchId, sessionId, appSessionId, journalPath } = await recordedInit({
      checkpointRows: 1, // a checkpoint at every row: the request's own row among them
      maxBytes: JOURNAL_MAX_BYTES,
      checkpoint: (c) => live.push(c),
      // an unrecorded read, so the replay answers it with an empty success a few rows on
      beforeSend: (session) => void session.control!.requestRaw('get_skills_dialog', { probe: undefined }).catch(() => {}),
    });
    const rows = readFileSync(journalPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { seq: number; direction: string; frame: { type?: string; request_id?: string; request?: Record<string, unknown>; response?: { request_id?: string } } });
    const asked = rows.filter((r) => r.direction === 'out' && r.frame.request?.subtype === 'get_skills_dialog');
    expect(asked).toHaveLength(1);
    const at = asked[0]!.seq;
    const requestId = asked[0]!.frame.request_id!;
    expect(asked[0]!.frame.request, 'the journal holds no `probe`').toEqual({ subtype: 'get_skills_dialog' });
    const answered = rows.find((r) => r.direction === 'in' && r.frame.response?.request_id === requestId)!.seq;
    expect(answered).toBeGreaterThan(at + 1); // read on from the request's row, the answer is normalised on the restored state
    const lastSeq = rows.at(-1)!.seq;
    const options = { appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, historyThrough: lastSeq };

    const atRequest = live.find((c) => c.through === at)!;
    const restored = (deserialize(atRequest.state) as NormalizerState).outbound.get(requestId as RequestId)!.request as Record<string, unknown>;
    expect(Object.hasOwn(restored, 'probe'), 'the restored state keeps the member').toBe(true);
    expect(restored.probe).toBeUndefined();
    const taken = vi.spyOn(SessionStream.prototype, 'checkpoint');
    await new SessionStream({ ...options, checkpointRows: 1 }).snapshot(null, null);
    const scanned = taken.mock.calls.map(([c]) => c).find((c) => c.through === at)!;
    taken.mockRestore();
    expect(Object.hasOwn((deserialize(scanned.state) as NormalizerState).outbound.get(requestId as RequestId)!.request as object, 'probe'), 'a scan\'s has none').toBe(false);
    expect(scanned.state.equals(atRequest.state), 'so the two buffers differ').toBe(false);

    const lines: string[] = [];
    const today = new SessionStream({ ...options, checkpointRows: NONE });
    for (let cursor = lastSeq - 1; cursor >= at; cursor -= 1) {
      const fed = new SessionStream({ ...options, checkpointRows: NONE, log: (line) => lines.push(line) }); // takes none of its own
      fed.checkpoint(atRequest);
      lines.length = 0;
      const answer = await fed.snapshot(cursor, null);
      expect(readOf(journalLines(lines)[0]!).from, `after ${cursor}: from the live checkpoint`).toBe(at);
      expect(answer, `after ${cursor}`).toStrictEqual(await today.snapshot(cursor, null));
      expect(answer.events.map((e) => [e.id, e.seq])).toEqual(events.filter((e) => e.seq! > cursor).map((e) => [e.id, e.seq]));
    }
  });

  // Decision Log 30: the journal writes a parsed frame back with JSON.stringify, which writes a negative zero as `0` and
  // an index past a double's range (`1e400`, read as Infinity) as `null`. A live normaliser that read such a line holds
  // what no scan of the journal holds, so from that line on its launch takes no live checkpoint (one host.log line
  // says so), and reads begin at the checkpoints taken before it or at scans' own, which agree with the journal.
  for (const [literal, what] of [['1e400', "an index past a double's range"], ['-0', 'a negative zero index']] as const) {
    it(`a launch whose engine line holds ${what} takes no live checkpoint from that line on, and every read answers as a full scan`, async () => {
      const live: Checkpoint[] = [];
      const logs: string[] = [];
      let rewritten = 0;
      // every stream event of the first block (index 0) as the engine would have written it with the literal
      const wrap = (inner: EngineTransport): EngineTransport => ({
        ...inner,
        pid: inner.pid,
        exited: inner.exited,
        stderr: inner.stderr,
        write: (frame) => inner.write(frame),
        endInput: () => inner.endInput(),
        kill: (signal) => inner.kill(signal),
        frames: {
          async *[Symbol.asyncIterator]() {
            for await (const item of inner.frames) {
              if (item.error !== null || !item.raw.startsWith('{"type":"stream_event"') || !/"index":0[,}]/.test(item.raw)) yield item;
              else {
                rewritten += 1;
                yield parseStdoutLine(item.raw.replace(/"index":0([,}])/, `"index":${literal}$1`));
              }
            }
          },
        },
      });
      const { launchId, sessionId, appSessionId, journalPath } = await recordedInit({ checkpointRows: 1, maxBytes: JOURNAL_MAX_BYTES, checkpoint: (c) => live.push(c), wrap, log: (message) => logs.push(message) });
      const rows = readFileSync(journalPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { seq: number; direction: string; frame: { type?: string; event?: { type?: string; index?: unknown } } });
      const blockEvents = rows.filter((r) => r.direction === 'in' && r.frame.type === 'stream_event' && r.frame.event?.type?.startsWith('content_block_') === true && r.frame.event!.index !== 1);
      expect(rewritten).toBeGreaterThan(2);
      expect(blockEvents).toHaveLength(rewritten);
      expect(blockEvents.map((r) => r.frame.event!.index), 'what the journal wrote back').toEqual(blockEvents.map(() => (literal === '1e400' ? null : 0)));
      const first = blockEvents[0]!.seq;
      expect(logs.filter((m) => m.startsWith('live checkpoints off'))).toEqual([`live checkpoints off for launch ${launchId} at seq ${first}: an engine line holds a number the journal writes otherwise`]);
      const lastSeq = rows.at(-1)!.seq;
      expect(lastSeq).toBeGreaterThan(first + 5);
      expect(live.length, 'live checkpoints up to the line').toBe(first - 1);
      expect(live.every((c) => c.through < first)).toBe(true);
      const options = { appSessionId, launchId, sessionId: sessionId as never, journalPath, emit: recorder().emit, historyThrough: lastSeq };
      const today = new SessionStream({ ...options, checkpointRows: NONE });
      for (let cursor = lastSeq; cursor >= 0; cursor -= 1) {
        const fed = new SessionStream({ ...options, checkpointRows: 1 }); // the live ones, and its own scans' at every row
        for (const c of live) fed.checkpoint(c);
        expect(await fed.snapshot(cursor, 3), `after ${cursor}`).toStrictEqual(await today.snapshot(cursor, 3));
      }
    });
  }

  it('keeps every boundary of the newest dense region, one in eight of the older, at most forty, the oldest first to go', async () => {
    const journal = shapedJournal();
    const every = 2;
    const { checkpoints, lastSeq } = await scanned(journal, every);
    expect(checkpoints.length, 'many boundaries').toBeGreaterThan(CHECKPOINTS_MAX * CHECKPOINT_SPARSE_EVERY);
    const held = rule(checkpoints, every);
    expect(held).toHaveLength(CHECKPOINTS_MAX);
    const kept = held.map((h) => h.through);
    const sparse = kept.filter((through) => kept.at(-1)! / every - through / every >= CHECKPOINTS_DENSE);
    expect(sparse.length).toBeGreaterThan(0);
    expect(sparse.every((through) => (through / every) % CHECKPOINT_SPARSE_EVERY === 0)).toBe(true);
    // the stream that scanned holds that set: each read begins at the newest of it at or before its cursor, or at the
    // first row before the oldest; read newest first, so that no read goes on from the page before it
    const lines: string[] = [];
    const a = streamOn(journal, every, lines);
    expect((await a.snapshot(null, null)).lastSeq).toBe(lastSeq);
    expect(lines.filter((line) => line.startsWith('checkpoint ')).at(-1)).toBe(`checkpoint ${APP_CP} launch ${LAUNCH_CP} at seq ${held.at(-1)!.through}: ${held.at(-1)!.bytes} bytes; ${held.length} held, ${held.reduce((n, h) => n + h.bytes, 0)} bytes`);
    const cursors = [...new Set([lastSeq - 1, kept.at(-1)!, kept.at(-1)! - 1, ...kept.map((through) => through + 1), kept[0]! - 1, 5])].filter((cursor) => cursor < lastSeq).sort((x, y) => y - x);
    const b = streamOn(journal, NONE);
    for (const cursor of cursors) {
      const read = await readWith(a, lines, cursor, 1);
      expect(read.answer).toStrictEqual(await b.snapshot(cursor, 1));
      expect(read.from, `after ${cursor}`).toBe(kept.filter((through) => through <= cursor).at(-1) ?? null);
    }
  });

  it('drops the oldest while the states pass the byte cap', async () => {
    const journal = shapedJournal();
    const every = 25;
    const padding = 'x'.repeat(400 * 1024);
    const padded = (await scanned(journal, every)).checkpoints.slice(0, 10).map((c) => ({ ...c, state: serialize({ ...(deserialize(c.state) as object), padding }) }));
    const held = rule(padded, every);
    expect(held.length).toBeLessThan(padded.length);
    expect(held.map((h) => h.through)).toEqual(padded.slice(-held.length).map((c) => c.through)); // the newest stay
    const total = held.reduce((n, h) => n + h.bytes, 0);
    expect(total).toBeLessThanOrEqual(CHECKPOINT_BYTES);
    const lines: string[] = [];
    holding(journal, every, padded, lines);
    expect(lines.at(-1)).toBe(`checkpoint ${APP_CP} launch ${LAUNCH_CP} at seq ${padded.at(-1)!.through}: ${padded.at(-1)!.state.length} bytes; ${held.length} held, ${total} bytes`);
    for (const c of padded) {
      const read = await readWith(holding(journal, every, padded, lines), lines, c.through, 5);
      expect(read.answer).toStrictEqual(await streamOn(journal, NONE).snapshot(c.through, 5));
      expect(read.from, `after ${c.through}`).toBe(held.some((h) => h.through === c.through) ? c.through : null);
    }
  });

  it('an adopted stream, which begins with none, leaves checkpoints behind its first scan and reads from them next', async () => {
    const journal = shapedJournal();
    const every = 25;
    const lines: string[] = [];
    const a = streamOn(journal, every, lines); // historyThrough: an adopted launch's stream, its whole journal before it
    const first = await readWith(a, lines, journal.lastSeq - 300, 10);
    expect(first.from, 'the first read: from the first row').toBeNull();
    expect(lines.filter((line) => line.startsWith('checkpoint ')).length).toBeGreaterThan(0);
    const cursor = journal.lastSeq - 400; // before the first read's cursor: no page goes on to it
    const next = await readWith(a, lines, cursor, 10);
    expect(next.answer).toStrictEqual(await streamOn(journal, NONE).snapshot(cursor, 10));
    expect(next.from).toBe(Math.floor(cursor / every) * every);
  });

  it('a checkpoint whose file is gone, or whose state cannot be read back, gives today\'s scan and today\'s answer', async () => {
    const journal = shapedJournal();
    const every = 25;
    const { checkpoints } = await scanned(journal, every);
    const newest = checkpoints.at(-1)!;
    const lines: string[] = [];
    const today = (afterSeq: number) => streamOn(journal, NONE).snapshot(afterSeq, 5);
    // a state that does not deserialise: the read starts over from the first row
    const broken = await readWith(holding(journal, every, [{ ...newest, state: Buffer.from('not a serialisation') }], lines), lines, newest.through + 1, 5);
    expect(broken.answer).toStrictEqual(await today(newest.through + 1));
    expect(broken.from).toBeNull();
    // the newest checkpoint's file, the launch's last, removed: today's scan reads the files before it, and so does this one
    expect(basename(journal.files.at(-1)!)).toBe(newest.file);
    rmSync(journal.files.at(-1)!);
    const cut = await readWith(holding(journal, every, checkpoints, lines), lines, newest.through + 1, 5);
    expect(cut.answer).toStrictEqual(await today(newest.through + 1));
    expect(cut.from).toBeNull();
    // a file in the middle removed: today's scan meets the gap and the ring answers alone, and so it does here
    rmSync(journal.files[1]!);
    const gap = await holding(journal, every, checkpoints, lines).snapshot(newest.through - 1, 5);
    expect(gap.historyUnavailable).toBe(true);
    expect(gap).toStrictEqual(await today(newest.through - 1));
  });
});
