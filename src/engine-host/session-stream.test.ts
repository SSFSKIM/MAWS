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
