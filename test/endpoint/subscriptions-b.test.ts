// Lane B's subscriptions (O10 M8; RL3; acceptance 2's lane B half against the fake engine host): a device subscribes to
// a lane B session by its appSessionId and a cursor `(launchId, seq, idx)` naming an event within its journal row, and
// gets `replay` (the events after its cursor, read by `session.events`), `snapshot` (the launch's events from its start)
// or `missing` (its launch's journal can't be read back), each with the session's replace-whole state (status, queue,
// pending items, catalog) refreshed under a hold of live events; then live events under credit, paused while no app is
// attached (until O3). Every event's full cursor is checked against the producer's own numbering: the id's launch, row
// and index within the row.
import type { SessionEvent } from '@shared/graph/events';
import { requestDigestOf } from '@shared/host/request-digest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cursorOf, done, drop, evs, HUB, item, makeOrg, of, openRemote, snapshot, snapshots, startEndpoint, stopAll, subscribe, until, waitFor, type Fixture, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

/** An endpoint whose engine host holds `app-1` (owned by the machine's owners), an app attached. */
async function lab(options: Parameters<typeof startEndpoint>[2] = {}): Promise<Fixture> {
  const f = await startEndpoint(org, started, options);
  const s = f.host.sessions.get('app-1') ?? f.host.add('app-1');
  f.records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'] }, 'app-1');
  f.host.attach(true);
  return f;
}

/** The device saw exactly `expected`, in order, each `ev` at its producer's cursor. */
function sawExactly(r: Remote, sub: string, expected: SessionEvent[], from = 0): void {
  const got = evs(r, sub, from);
  expect(got.map((e) => [e.epoch, e.seq, e.idx])).toEqual(expected.map((e) => Object.values(cursorOf(e))));
  expect(got.map((e) => (e.body as SessionEvent).id)).toEqual(expected.map((e) => e.id));
}

const lastCursor = (r: Remote, sub: string) => {
  const last = evs(r, sub).at(-1)!;
  return { epoch: last.epoch, seq: last.seq, idx: last.idx! };
};

describe('a lane B subscription', () => {
  it('answers a fresh subscription with a snapshot: the state, then the launch’s events from its start, then live ones', async () => {
    const f = await lab();
    const before = [...f.host.row('app-1', 2), ...f.host.row('app-1', 1)];
    const a = await openRemote(f, org.a1, org.A);
    const subbed = await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    expect(subbed).toMatchObject({ t: 'subbed', mode: 'snapshot', epoch: f.host.session('app-1').launchId, seq: 0 });
    const snap = await snapshot(a, 's1');
    expect(snap.body).toMatchObject({ status: { launchId: f.host.session('app-1').launchId }, queue: { entries: [] }, pendingItems: [], catalog: { revision: 1 } });
    await until(() => evs(a, 's1').length === 3, 'the launch’s events');
    const live = f.host.row('app-1', 2);
    await until(() => evs(a, 's1').length === 5, 'the live events');
    sawExactly(a, 's1', [...before, ...live]);
  });

  it('resumes on the same launch by `afterSeq`: a replay of exactly what the device missed, across a forced drop', async () => {
    const f = await lab();
    const first = [...f.host.row('app-1', 2), ...f.host.row('app-1', 3)];
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await until(() => evs(a, 's1').length === 5, 'the first rows');
    const cursor = lastCursor(a, 's1');
    drop(a);
    const missed = [...f.host.row('app-1', 2), ...f.host.row('app-1', 1)];
    const b = await openRemote(f, org.a1, org.A);
    expect(await subscribe(b, 's1', { lane: 'B', id: 'app-1' }, { cursor })).toMatchObject({ mode: 'replay', ...cursor });
    await until(() => evs(b, 's1').length === 3, 'the replay');
    const live = f.host.row('app-1', 1);
    await until(() => evs(b, 's1').length === 4, 'the live event');
    sawExactly(b, 's1', [...missed, ...live]);
    sawExactly(a, 's1', first);
  });

  it('delivers the rest of a row exactly once when the channel dropped between two of its events (a batch cut inside the row)', async () => {
    const f = await lab();
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    const s = f.host.session('app-1');
    // Row 1 has four events; only its first two reach the device before the drop.
    const row = Array.from({ length: 4 }, (_, i) => f.host.event(s, 1, i, { kind: 'note', text: `split ${i}` }));
    s.rows.push(row);
    f.host.batches('app-1', row.slice(0, 2));
    await until(() => evs(a, 's1').length === 2, 'the row’s first half');
    const cursor = lastCursor(a, 's1');
    expect(cursor).toEqual({ epoch: s.launchId, seq: 1, idx: 1 });
    drop(a);
    f.host.batches('app-1', row.slice(2));
    const next = f.host.row('app-1', 1, { live: false });
    const b = await openRemote(f, org.a1, org.A);
    expect(await subscribe(b, 's1', { lane: 'B', id: 'app-1' }, { cursor })).toMatchObject({ mode: 'replay' });
    await until(() => evs(b, 's1').length === 3, 'the rest');
    sawExactly(b, 's1', [row[2], row[3], next[0]]);
  });

  it('answers a cursor on another launch with a snapshot of the new launch', async () => {
    const f = await lab();
    f.host.row('app-1', 2);
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await until(() => evs(a, 's1').length === 2, 'the old launch');
    const cursor = lastCursor(a, 's1');
    drop(a);
    const s = f.host.relaunch('app-1');
    const fresh = f.host.row('app-1', 2);
    const b = await openRemote(f, org.a1, org.A);
    expect(await subscribe(b, 's1', { lane: 'B', id: 'app-1' }, { cursor })).toMatchObject({ mode: 'snapshot', epoch: s.launchId, seq: 0 });
    await until(() => evs(b, 's1').length === 2, 'the new launch');
    sawExactly(b, 's1', fresh);
  });

  it('moves a live subscription to the new launch when the session is launched again', async () => {
    const f = await lab();
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    const old = f.host.row('app-1', 1);
    await until(() => evs(a, 's1').length === 1, 'the first launch');
    const s = f.host.relaunch('app-1');
    const fresh = f.host.row('app-1', 2);
    await waitFor(a, (m) => m.t === 'subbed' && m.epoch === s.launchId, 'a snapshot under the new launch');
    await until(() => evs(a, 's1').length === 3, 'the new launch’s events');
    sawExactly(a, 's1', [...old, ...fresh]);
  });

  it('answers `missing` when the cursor’s rows are gone from the launch’s journal, then what remains', async () => {
    const f = await lab();
    f.host.row('app-1', 1);
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await until(() => evs(a, 's1').length === 1, 'row 1');
    const cursor = lastCursor(a, 's1');
    drop(a);
    for (let i = 0; i < 3; i++) f.host.row('app-1', 1);
    const s = f.host.session('app-1');
    // Rows 1 and 2 are gone: the ring holds rows 3 and 4, and the journal can't be read back.
    s.evicted = { seq: 2, idx: 0 };
    s.journal = false;
    const b = await openRemote(f, org.a1, org.A);
    expect(await subscribe(b, 's1', { lane: 'B', id: 'app-1' }, { cursor })).toMatchObject({ mode: 'missing', epoch: s.launchId, seq: 0 });
    await snapshot(b, 's1');
    await until(() => evs(b, 's1').length === 2, 'what remains');
    sawExactly(b, 's1', [s.rows[2][0], s.rows[3][0]]);
  });

  it('pauses while no app is attached, and catches up from its cursor when one is (`resumed`)', async () => {
    const f = await lab();
    f.host.attach(false);
    const before = f.host.row('app-1', 1);
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await waitFor(a, (m) => m.t === 'paused' && m.sub === 's1' && m.reason === 'no-app', 'paused');
    const during = f.host.row('app-1', 2);
    f.host.setItems('app-1', [item(f.host.session('app-1'), 'rq-q', 'question')]);
    const from = a.inbox.length;
    f.host.attach(true);
    await waitFor(a, (m) => m.t === 'resumed' && m.sub === 's1', 'resumed', from);
    await until(() => evs(a, 's1').length === 3, 'the catch-up');
    const snap = await snapshot(a, 's1', from);
    expect(snap.body.pendingItems).toMatchObject([{ request: { requestId: 'rq-q' } }]);
    const live = f.host.row('app-1', 1);
    await until(() => evs(a, 's1').length === 4, 'live again');
    sawExactly(a, 's1', [...before, ...during, ...live]);
    f.host.attach(false);
    await waitFor(a, (m) => m.t === 'paused' && m.sub === 's1', 'paused again', from);
  });

  it('shows a question already pending at subscription, with no later broker change', async () => {
    const f = await lab();
    f.host.request('app-1', 'question', 'rq-1');
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    expect((await snapshot(a, 's1')).body.pendingItems).toMatchObject([{ kind: 'question', request: { requestId: 'rq-1' } }]);
  });

  it('brings a card settled and a queue edited while the channel was down current on a same-launch replay', async () => {
    const f = await lab();
    f.host.request('app-1', 'question', 'rq-1');
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await until(() => evs(a, 's1').length === 1, 'the request row');
    const cursor = lastCursor(a, 's1');
    drop(a);
    f.host.setItems('app-1', []);
    f.host.setQueue('app-1', { entries: [{ queueId: 'q1', text: 'next' }], paused: false, pauseReason: null });
    const b = await openRemote(f, org.a1, org.A);
    expect(await subscribe(b, 's1', { lane: 'B', id: 'app-1' }, { cursor })).toMatchObject({ mode: 'replay' });
    const snap = await snapshot(b, 's1');
    expect(snap.body.pendingItems).toEqual([]);
    expect(snap.body.queue).toMatchObject({ entries: [{ queueId: 'q1' }] });
    expect(evs(b, 's1')).toEqual([]);
  });

  it('ends in the newer pending set when the broker changes during the snapshot’s read', async () => {
    const f = await lab();
    f.host.request('app-1', 'question', 'rq-old');
    f.host.hold('session.pendingItems');
    const a = await openRemote(f, org.a1, org.A);
    await a.channel.send({ t: 'sub', sub: 's1', session: { lane: 'B', id: 'app-1' }, cursor: null, credit: 4 * 1024 * 1024 });
    await until(() => f.host.calls.some((c) => c.name === 'session.pendingItems'), 'the items’ read in flight');
    // The read was answered with rq-old; before its answer arrives the broker moves to rq-new and publishes it.
    f.host.setItems('app-1', [item(f.host.session('app-1'), 'rq-new', 'question')]);
    f.host.release('session.pendingItems');
    await until(() => f.host.calls.filter((c) => c.name === 'session.pendingItems').length === 2, 'one more read');
    f.host.release('session.pendingItems');
    await until(() => (snapshots(a, 's1').at(-1)?.pendingItems as Array<{ request: { requestId: string } }> | undefined)?.[0]?.request.requestId === 'rq-new', 'the newer set last');
    expect(snapshots(a, 's1').map((s) => (s.pendingItems as Array<{ request: { requestId: string } }>)[0]?.request.requestId)).toEqual(['rq-old', 'rq-new']);
  });

  it('keeps its events whole when the device’s credit runs out: it reads the rest from the journal as credit comes back', async () => {
    const f = await lab({ subscriptions: { backlogBytes: 4096 } });
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' }, { credit: 2048 });
    await snapshot(a, 's1');
    const rows: SessionEvent[] = [];
    for (let i = 0; i < 40; i++) rows.push(...f.host.row('app-1', 2));
    await until(() => evs(a, 's1').length > 0, 'some events');
    await new Promise((r) => setTimeout(r, 100));
    const stalled = evs(a, 's1').length;
    expect(stalled).toBeLessThan(rows.length);
    for (let i = 0; i < 60 && evs(a, 's1').length < rows.length; i++) {
      await a.channel.send({ t: 'credit', sub: 's1', bytes: 4096 });
      await new Promise((r) => setTimeout(r, 20));
    }
    await until(() => evs(a, 's1').length === rows.length, 'every event');
    sawExactly(a, 's1', rows);
  });

  it('takes credit that arrives before the subscription is authorized', async () => {
    const f = await lab();
    f.host.row('app-1', 3);
    f.host.hold('session.status');
    const a = await openRemote(f, org.a1, org.A);
    await a.channel.send({ t: 'sub', sub: 's1', session: { lane: 'B', id: 'app-1' }, cursor: null, credit: 1 });
    await a.channel.send({ t: 'credit', sub: 's1', bytes: 1024 * 1024 });
    f.host.release('session.status');
    await until(() => evs(a, 's1').length === 3, 'the events the early credit pays for');
  });
});

describe('a lane B `cards` subscription', () => {
  it('carries only the pending requests, each hydrated with its request, its context and its digest, and never the transcript, the queue or the catalog', async () => {
    const f = await lab();
    const question = f.host.request('app-1', 'question', 'rq-q');
    const permission = f.host.request('app-1', 'permission', 'rq-p');
    const a = await openRemote(f, org.a1, org.A);
    expect(await subscribe(a, 'c1', { lane: 'B', id: 'app-1' }, { view: 'cards' })).toMatchObject({ mode: 'snapshot' });
    const snap = await snapshot(a, 'c1');
    expect(Object.keys(snap.body)).toEqual(['pendingItems']);
    const s = f.host.session('app-1');
    const cards = snap.body.pendingItems as Array<Record<string, unknown>>;
    expect(cards.map((c) => (c.request as SessionEvent).id)).toEqual([question.id, permission.id]);
    expect(cards[0]).toMatchObject({ item: { kind: 'question' }, context: { launchId: s.launchId, engineSessionId: s.engineSessionId }, requestDigest: requestDigestOf('app-1', question) });
    expect(cards[1]).toMatchObject({ item: { kind: 'permission' }, requestDigest: requestDigestOf('app-1', permission) });
    f.host.row('app-1', 2);
    f.host.setQueue('app-1', { entries: [{ queueId: 'q1' }], paused: false, pauseReason: null });
    f.host.setItems('app-1', [s.items[1]]);
    await until(() => of(a, 'c1').filter((m) => m.t === 'snap').length >= 2, 'the settlement');
    const settled = await snapshot(a, 'c1', a.inbox.findLastIndex((m) => (m as { t: string; page?: number }).t === 'snap' && (m as { page?: number }).page === 0));
    expect((settled.body.pendingItems as unknown[]).length).toBe(1);
    expect(evs(a, 'c1')).toEqual([]);
    expect(of(a, 'c1').every((m) => m.t !== 'snap' || !Object.keys(JSON.parse(m.body as string) as object).some((k) => k !== 'pendingItems'))).toBe(true);
  });

  it('answers a resumed cards subscription with a snapshot of what is pending now, which a web-cards device subscribes to on a session its member owns and answers from the card alone', async () => {
    const f = await lab();
    const s = f.host.session('app-1');
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: [org.C] }, 'app-1');
    f.host.request('app-1', 'permission', 'rq-p');
    const c = await openRemote(f, org.c1, org.C, { passkey: org.passkey });
    expect(await subscribe(c, 'full', { lane: 'B', id: 'app-1' })).toMatchObject({ t: 'ended', reason: 'class' });
    const first = await subscribe(c, 'c1', { lane: 'B', id: 'app-1' }, { view: 'cards' });
    drop(c);
    f.host.request('app-1', 'question', 'rq-q');
    const again = await openRemote(f, org.c1, org.C, { passkey: org.passkey });
    expect(await subscribe(again, 'c1', { lane: 'B', id: 'app-1' }, { view: 'cards', cursor: { epoch: first.epoch as string, seq: 0 } })).toMatchObject({ mode: 'snapshot' });
    const snap = await snapshot(again, 'c1');
    const cards = snap.body.pendingItems as Array<{ item: { kind: string; request: { requestId: string } }; context: { launchId: string; engineSessionId: string }; requestDigest: unknown }>;
    expect(cards.map((card) => card.item.kind)).toEqual(['permission', 'question']);
    // What the card carries is all an answer needs: its context and its digest, which the engine host checks at the claim.
    const answers = [{ kind: 'permission', decision: 'allow', scope: 'once' }, { kind: 'question', answers: { 'Which way?': 'left' } }];
    for (const [i, card] of cards.entries()) {
      const action = await again.device.webauthn(
        again.device.action({ machine: f.ref, action: 'session.answer', session: 'app-1', context: { lane: 'B', ...card.context }, requestDigest: card.requestDigest as never, args: { appSessionId: 'app-1', requestId: card.item.request.requestId, answer: answers[i] } }),
        HUB,
      );
      const from = again.inbox.length;
      expect(await act(again, action)).toBe('ok');
      expect(await done(again, action, from)).toEqual({ state: 'done', result: { outcome: 'delivered' } });
    }
    expect(f.host.answered).toEqual(['app-1 rq-p', 'app-1 rq-q']);
    await until(() => (JSON.parse(of(again, 'c1').filter((m) => m.t === 'snap').at(-1)!.body as string) as { pendingItems: unknown[] }).pendingItems.length === 0, 'the cards settled');
  });
});

describe('access, re-checked whenever it can change', () => {
  it('ends a live subscription when a share is removed, and refuses its resume', async () => {
    const f = await lab();
    const s = f.host.session('app-1');
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: [org.A], shares: [{ member: org.B, grade: 'view' }] }, 'app-1');
    const b = await openRemote(f, org.b1, org.B);
    const subbed = await subscribe(b, 's1', { lane: 'B', id: 'app-1' });
    expect(subbed).toMatchObject({ t: 'subbed' });
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: [org.A] }, 'app-1');
    await waitFor(b, (m) => m.t === 'ended' && m.sub === 's1' && m.reason === 'removed', 'ended removed');
    expect(await subscribe(b, 's2', { lane: 'B', id: 'app-1' }, { cursor: { epoch: subbed.epoch as string, seq: 0 } })).toMatchObject({ t: 'ended', reason: 'grade' });
  });

  it('ends a live subscription when its session is made private', async () => {
    const f = await lab();
    const s = f.host.session('app-1');
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: [org.A], access: 'org-view' }, 'app-1');
    const b = await openRemote(f, org.b1, org.B);
    await subscribe(b, 's1', { lane: 'B', id: 'app-1' });
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: [org.A], access: 'private' }, 'app-1');
    await waitFor(b, (m) => m.t === 'ended' && m.sub === 's1' && m.reason === 'removed', 'ended removed');
  });
});

describe('interest (OX5)', () => {
  it('reports a lane B subscription’s session, holds it through the resume window after the channel closes, and drops it after', async () => {
    const f = await lab({ subscriptions: { resumeMs: 150 } });
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    const viewer = await until(() => f.interest.find((x) => x[0] === 'report' && x[2]?.includes('app-1'))?.[1], 'the report');
    expect(viewer).toMatch(/^a1\//);
    drop(a);
    await new Promise((r) => setTimeout(r, 60));
    expect(f.interest.some((x) => x[0] === 'drop' && x[1] === viewer)).toBe(false);
    await until(() => f.interest.some((x) => x[0] === 'drop' && x[1] === viewer), 'the drop after the window');
  });

  it('drops a viewer’s session when it unsubscribes', async () => {
    const f = await lab();
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    const viewer = await until(() => f.interest.find((x) => x[0] === 'report')?.[1], 'the report');
    await a.channel.send({ t: 'unsub', sub: 's1' });
    await until(() => f.interest.some((x) => x[0] === 'drop' && x[1] === viewer), 'the drop');
  });
});

// ---- Under pressure: a lost journal, a long one, a flood, changes that never settle (O10 M8 review round 1) ------------

const MiB = 1024 * 1024;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reads = (f: Fixture, name: string) => f.host.calls.filter((c) => c.name === name).length;
type Card = { item: { request: { requestId: string } }; context: { launchId: string } };

describe('a lane B subscription whose journal can’t give back what it needs', () => {
  it('answers `missing`, not `replay`, when the ring begins inside the cursor’s row past its next event', async () => {
    const f = await lab();
    const s = f.host.session('app-1');
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await snapshot(a, 's1');
    const row = Array.from({ length: 5 }, (_, i) => f.host.event(s, 1, i, { kind: 'note', text: `e${i}` }));
    s.rows.push(row);
    f.host.batches('app-1', row.slice(0, 1));
    await until(() => evs(a, 's1').length === 1, 'the row’s first event');
    const cursor = lastCursor(a, 's1');
    drop(a);
    f.host.batches('app-1', row.slice(1));
    // The ring dropped (1,0) through (1,2) and the journal is lost: what the device lacks, (1,1) and (1,2), is gone.
    s.evicted = { seq: 1, idx: 2 };
    s.journal = false;
    const b = await openRemote(f, org.a1, org.A);
    expect(await subscribe(b, 's1', { lane: 'B', id: 'app-1' }, { cursor })).toMatchObject({ mode: 'missing' });
  });

  it('answers `missing` when its catch-up finds the ring beginning past the next event of its row', async () => {
    const f = await lab({ subscriptions: { backlogBytes: 1 } });
    const s = f.host.session('app-1');
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' }, { credit: 1 });
    await until(() => of(a, 's1').some((m) => m.t === 'snap'), 'the snapshot');
    await until(() => reads(f, 'session.events') >= 1, 'the first catch-up');
    await sleep(30);
    // (1,0) goes into the stream, past the credit; the device's unsent stream is then full, so (1,1) on are left to the
    // journal, which loses them before the credit comes.
    f.host.row('app-1', 5);
    await sleep(30);
    s.evicted = { seq: 1, idx: 1 };
    s.journal = false;
    await a.channel.send({ t: 'credit', sub: 's1', bytes: MiB });
    await waitFor(a, (m) => m.t === 'subbed' && m.sub === 's1' && m.mode === 'missing', 'a `missing` start-over');
  });
});

describe('a lane B subscription reading a long journal', () => {
  it('pages on from each page’s last row, never reading a page’s rows again', async () => {
    const f = await lab();
    const s = f.host.session('app-1');
    for (let i = 0; i < 1200; i++) f.host.row('app-1', 1, { live: false });
    s.evicted = { seq: 1200, idx: 0 }; // every row is the journal's
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await until(() => evs(a, 's1').length === 1200, 'every event', 10_000);
    sawExactly(a, 's1', s.rows.flat());
    expect(f.host.calls.filter((c) => c.name === 'session.events').map((c) => (c.input as { afterSeq: number | null }).afterSeq)).toEqual([null, 500, 1000]);
  });
});

describe('a lane B subscription whose access is checked again', () => {
  it('holds its stream while the check is open: a viewer whose share was removed gets nothing produced meanwhile; one who kept it gets all of it', async () => {
    const f = await lab();
    const s = f.host.session('app-1');
    const shared = { lane: 'B' as const, session: s.engineSessionId!, owners: [org.A], shares: [{ member: org.B, grade: 'view' as const }] };
    f.records.set(shared, 'app-1');
    const b = await openRemote(f, org.b1, org.B);
    await subscribe(b, 's1', { lane: 'B', id: 'app-1' });
    await snapshot(b, 's1');
    // A change that keeps the share: held while checked, then delivered.
    f.host.hold('session.status');
    let before = reads(f, 'session.status');
    f.records.set({ ...shared }, 'app-1');
    await until(() => reads(f, 'session.status') > before, 'the check’s status read');
    const kept = f.host.row('app-1', 2);
    await sleep(80);
    expect(evs(b, 's1')).toEqual([]);
    f.host.release('session.status');
    await until(() => evs(b, 's1').length === 2, 'the events held through the check');
    sawExactly(b, 's1', kept);
    // The share removed: what comes while the check reads never reaches the device.
    f.host.hold('session.status');
    before = reads(f, 'session.status');
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: [org.A] }, 'app-1');
    await until(() => reads(f, 'session.status') > before, 'the second check’s status read');
    f.host.row('app-1', 2);
    await sleep(80);
    f.host.release('session.status');
    await waitFor(b, (m) => m.t === 'ended' && m.sub === 's1' && m.reason === 'removed', 'ended removed');
    sawExactly(b, 's1', kept);
  });
});

describe('a lane B subscription whose state keeps changing', () => {
  it('keeps only the latest of each replace-whole part queued while the device’s credit is out', async () => {
    const f = await lab();
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' }, { credit: 1 });
    await until(() => of(a, 's1').some((m) => m.t === 'snap' && m.last === true), 'the snapshot');
    for (let i = 0; i < 100; i++) f.host.setQueue('app-1', { entries: [{ queueId: `q${i}`, text: 'x'.repeat(64 * 1024) }], paused: false, pauseReason: null });
    const queueId = (snap: Record<string, unknown>) => (snap.queue as { entries: Array<{ queueId: string }> } | undefined)?.entries[0]?.queueId;
    for (let i = 0; i < 20 && queueId(snapshots(a, 's1').at(-1)!) !== 'q99'; i++) {
      await a.channel.send({ t: 'credit', sub: 's1', bytes: 4 * MiB });
      await sleep(40);
    }
    expect(queueId(snapshots(a, 's1').at(-1)!)).toBe('q99');
    expect(snapshots(a, 's1').filter((snap) => !('status' in snap)).length).toBeLessThanOrEqual(2);
  });

  it('ends in the latest change even when the state changed through every one of its re-reads', async () => {
    const f = await lab();
    const queue = (i: number) => ({ entries: [{ queueId: `q${i}` }], paused: false, pauseReason: null });
    f.host.hold('session.queue.list');
    const a = await openRemote(f, org.a1, org.A);
    await a.channel.send({ t: 'sub', sub: 's1', session: { lane: 'B', id: 'app-1' }, cursor: null, credit: 4 * MiB });
    // Each read is answered with the queue as it was asked; a newer one is published before the answer arrives.
    for (let k = 1; k <= 6; k++) {
      await until(() => reads(f, 'session.queue.list') === k, `read ${k}`);
      f.host.setQueue('app-1', queue(k));
      f.host.release('session.queue.list');
      if (k < 6) f.host.hold('session.queue.list');
    }
    await until(() => (snapshots(a, 's1').at(-1)?.queue as { entries: Array<{ queueId: string }> } | undefined)?.entries[0]?.queueId === 'q6', 'the latest queue');
  });

  it('starts a cards subscription over on the new launch when the session is launched again while its cards are hydrated', async () => {
    const f = await lab();
    const s = f.host.session('app-1');
    f.host.request('app-1', 'question', 'rq-old');
    f.host.hold('session.pendingRequest');
    const a = await openRemote(f, org.a1, org.A);
    await a.channel.send({ t: 'sub', sub: 'c1', session: { lane: 'B', id: 'app-1' }, view: 'cards', cursor: null, credit: 4 * MiB });
    await until(() => reads(f, 'session.pendingRequest') >= 1, 'the hydration in flight');
    f.host.setItems('app-1', []);
    f.host.relaunch('app-1');
    f.host.request('app-1', 'question', 'rq-new');
    f.host.release('session.pendingRequest');
    await until(() => {
      const cards = snapshots(a, 'c1').at(-1)?.pendingItems as Card[] | undefined;
      return cards?.length === 1 && cards[0].item.request.requestId === 'rq-new';
    }, 'the new launch’s card');
    const cards = snapshots(a, 'c1').at(-1)!.pendingItems as Card[];
    expect(cards[0].context.launchId).toBe(s.launchId);
    expect(of(a, 'c1').some((m) => m.t === 'subbed' && m.epoch === s.launchId)).toBe(true);
  });

  it('drops what it held past its bound while it read, and reads that from the journal instead', async () => {
    const f = await lab({ subscriptions: { backlogBytes: 16 * 1024 } });
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await snapshot(a, 's1');
    const first = f.host.row('app-1', 1);
    await until(() => evs(a, 's1').length === 1, 'row 1');
    const cursor = lastCursor(a, 's1');
    drop(a);
    f.host.hold('session.catalog');
    const b = await openRemote(f, org.a1, org.A);
    await b.channel.send({ t: 'sub', sub: 's1', session: { lane: 'B', id: 'app-1' }, cursor, credit: 4 * MiB });
    await until(() => reads(f, 'session.catalog') === 2, 'the resume’s state read in flight');
    const flood: SessionEvent[] = [];
    for (let i = 0; i < 200; i++) flood.push(...f.host.row('app-1', 1));
    const journalReads = reads(f, 'session.events');
    f.host.release('session.catalog');
    await until(() => evs(b, 's1').length === 200, 'the flood');
    sawExactly(b, 's1', flood);
    expect(reads(f, 'session.events')).toBeGreaterThan(journalReads);
    expect(first).toHaveLength(1);
  });
});

// ---- Review round 2 (O10 M8) ---------------------------------------------------------------------------------------------

describe('a lane B subscription paging a journal that is lost between two pages', () => {
  it('answers `missing` when the engine host says the range it asked for is gone, whatever the page looks like', async () => {
    const f = await lab();
    const s = f.host.session('app-1');
    for (let i = 0; i < 1600; i++) f.host.row('app-1', 1, { live: false });
    s.evicted = { seq: 1000, idx: 0 }; // rows 1001-1600 in the ring, the rest the journal's
    f.host.hold('session.events');
    const a = await openRemote(f, org.a1, org.A);
    await a.channel.send({ t: 'sub', sub: 's1', session: { lane: 'B', id: 'app-1' }, cursor: null, credit: 4 * MiB });
    await until(() => reads(f, 'session.events') === 1, 'the first page asked');
    // The first page (rows 1-500) was read; the journal goes before the next: rows 501-1000 are gone, and the ring's
    // rows 1001 on make a whole page that begins on a row.
    s.journal = false;
    f.host.release('session.events');
    await waitFor(a, (m) => m.t === 'subbed' && m.sub === 's1' && m.mode === 'missing', 'a `missing` start-over', 0, 10_000);
    const before = of(a, 's1').findIndex((m) => m.t === 'subbed' && m.mode === 'missing');
    const seqs = of(a, 's1').slice(0, before).filter((m) => m.t === 'ev').map((m) => m.seq as number);
    expect(seqs.at(-1)).toBe(500);
   }, 15_000);
});

describe('a lane B subscription whose stream drains', () => {
  it('reads on from the journal as the device takes its stream, not only when credit comes', async () => {
    const f = await lab();
    const s = f.host.session('app-1');
    for (let i = 0; i < 1000; i++) {
      const event = f.host.event(s, i + 1, 0, { kind: 'note', text: 'w'.repeat(3 * 1024) });
      s.rows.push([event]);
    }
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' }, { credit: 1 });
    await until(() => of(a, 's1').some((m) => m.t === 'snap' && m.last === true), 'the snapshot');
    await until(() => reads(f, 'session.events') >= 1, 'the first page read');
    await sleep(50);
    // One grant covers all of it (about 3 MiB); the first page alone is past half the backlog when the grant comes.
    await a.channel.send({ t: 'credit', sub: 's1', bytes: 4 * MiB });
    await until(() => evs(a, 's1').length === 1000, 'every event', 10_000);
   }, 15_000);
});

describe('a lane B subscription whose access can’t be checked now', () => {
  it('stays held while the check answers `unavailable`, and ends `removed` once a retry finds the share gone', async () => {
    const f = await lab({ subscriptions: { recheckRetryMs: [40, 40, 40, 40, 40, 40, 40, 40] } });
    const s = f.host.session('app-1');
    const shared = { lane: 'B' as const, session: s.engineSessionId!, owners: [org.A], shares: [{ member: org.B, grade: 'view' as const }] };
    f.records.set(shared, 'app-1');
    const b = await openRemote(f, org.b1, org.B);
    await subscribe(b, 's1', { lane: 'B', id: 'app-1' });
    await snapshot(b, 's1');
    f.host.fail('session.status');
    const before = reads(f, 'session.status');
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: [org.A] }, 'app-1');
    await until(() => reads(f, 'session.status') > before + 1, 'a retry');
    f.host.row('app-1', 2);
    await sleep(120);
    expect(evs(b, 's1')).toEqual([]);
    f.host.heal('session.status');
    await waitFor(b, (m) => m.t === 'ended' && m.sub === 's1' && m.reason === 'removed', 'ended removed');
    expect(evs(b, 's1')).toEqual([]);
  });

  it('is not released by an app attaching while it is held', async () => {
    const f = await lab({ subscriptions: { recheckRetryMs: [40, 40, 40, 40, 40, 40, 40, 40] } });
    const s = f.host.session('app-1');
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await snapshot(a, 's1');
    f.host.fail('session.status');
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'] }, 'app-1');
    f.host.row('app-1', 2);
    // The attachment re-opens the stream (a catch-up and its state, queued behind the hold), which goes nowhere: its own
    // status read fails too, which ends it `unavailable` for the device to subscribe again.
    f.host.attach(false);
    f.host.attach(true);
    await sleep(120);
    expect(evs(a, 's1')).toEqual([]);
    expect(of(a, 's1').filter((m) => m.t === 'snap')).toHaveLength(1);
  });

  it('ends `unavailable` when the check can’t be answered within its retries, so a resume authorizes afresh', async () => {
    const f = await lab({ subscriptions: { recheckRetryMs: [20, 20] } });
    const s = f.host.session('app-1');
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await snapshot(a, 's1');
    f.host.fail('session.status');
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'] }, 'app-1');
    f.host.row('app-1', 1);
    await waitFor(a, (m) => m.t === 'ended' && m.sub === 's1' && m.reason === 'unavailable', 'ended unavailable');
    expect(evs(a, 's1')).toEqual([]);
  });

  it('goes on once a retry grants it, with everything produced while it was held', async () => {
    const f = await lab({ subscriptions: { recheckRetryMs: [40, 40, 40, 40] } });
    const s = f.host.session('app-1');
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await snapshot(a, 's1');
    f.host.fail('session.status');
    f.records.set({ lane: 'B', session: s.engineSessionId!, owners: ['@machine'] }, 'app-1');
    const held = f.host.row('app-1', 2);
    await sleep(60);
    expect(evs(a, 's1')).toEqual([]);
    f.host.heal('session.status');
    await until(() => evs(a, 's1').length === 2, 'the held events');
    sawExactly(a, 's1', held);
  });
});

// ---- Review round 3 (O10 M8) ---------------------------------------------------------------------------------------------

describe('a lane B subscription standing at the launch’s start when the journal is lost', () => {
  it('answers a resume from the snapshot’s cursor (`seq` 0) `missing` when the launch’s start is gone', async () => {
    const f = await lab();
    const s = f.host.session('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const first = await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    expect(first).toMatchObject({ mode: 'snapshot', seq: 0 });
    await snapshot(a, 's1');
    drop(a);
    // The device saw the snapshot and no event. While it is away the launch writes ten rows, the ring drops the first
    // four, and the journal is lost.
    for (let i = 0; i < 10; i++) f.host.row('app-1', 1);
    s.evicted = { seq: 4, idx: 0 };
    s.journal = false;
    const b = await openRemote(f, org.a1, org.A);
    expect(await subscribe(b, 's1', { lane: 'B', id: 'app-1' }, { cursor: { epoch: first.epoch as string, seq: 0 } })).toMatchObject({ mode: 'missing' });
  });

  it('replays a resume from the snapshot’s cursor from the launch’s first event while it is all there', async () => {
    const f = await lab();
    const a = await openRemote(f, org.a1, org.A);
    const first = await subscribe(a, 's1', { lane: 'B', id: 'app-1' });
    await snapshot(a, 's1');
    drop(a);
    const rows = [...f.host.row('app-1', 2), ...f.host.row('app-1', 1)];
    const b = await openRemote(f, org.a1, org.A);
    expect(await subscribe(b, 's1', { lane: 'B', id: 'app-1' }, { cursor: { epoch: first.epoch as string, seq: 0 } })).toMatchObject({ mode: 'replay' });
    await until(() => evs(b, 's1').length === 3, 'the launch’s events');
    sawExactly(b, 's1', rows);
  });

  it('starts over `missing` when an app attaches and its catch-up from the launch’s start finds the start gone', async () => {
    const f = await lab();
    const s = f.host.session('app-1');
    f.host.attach(false);
    const a = await openRemote(f, org.a1, org.A);
    expect(await subscribe(a, 's1', { lane: 'B', id: 'app-1' })).toMatchObject({ mode: 'snapshot' });
    await waitFor(a, (m) => m.t === 'paused' && m.sub === 's1', 'paused');
    // No app: the rows written meanwhile reach no one live; the ring drops the first four and the journal is lost.
    for (let i = 0; i < 10; i++) f.host.row('app-1', 1);
    s.evicted = { seq: 4, idx: 0 };
    s.journal = false;
    f.host.attach(true);
    await waitFor(a, (m) => m.t === 'subbed' && m.sub === 's1' && m.mode === 'missing', 'a `missing` start-over');
  });
});
