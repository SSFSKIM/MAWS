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
    s.prunedBefore = 3; // rows 1 and 2 are gone: the ring holds rows 3 and 4
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
