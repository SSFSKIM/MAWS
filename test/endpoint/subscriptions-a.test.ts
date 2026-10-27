// Lane A's subscriptions (O10 M8; RL3; acceptance 2's lane A half against the fake sminos): the endpoint mints the
// cursor. Each remote subscription holds its own upstream sminos subscription over RL10 (`subscribe`), whose id is the
// cursor's epoch; the endpoint numbers what the subscription carries (sminos's snapshot at 0, then every plane message of
// the session in arrival order) and keeps the last of it in a ring, so a resume inside the ring is a `replay` and any
// other a `snapshot` under a fresh upstream subscription. A dropped channel's upstream outlives it for the resume window.
// A `full` subscription carries every plane message sminos sends for the session, its `host` messages among them; a
// `cards` one only the session's pending requests and their settlement.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { counter, drop, evs, laneAMember, makeOrg, of, openRemote, plane, PROJECT, serve, snapshot, sminos, startEndpoint, stopAll, subscribe, until, waitFor, type Fixture, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

const RAISED = { request: 'toolu_1', session: 'la-1', tool: 'Bash', input: { command: 'ls' } };

/** The bodies of `sub`'s `ev`s, each the plane message's kind with its body. */
const kinds = (r: Remote, sub: string, from = 0) => evs(r, sub, from).map((e) => (e.body as { kind: string }).kind);

describe('a lane A `full` subscription', () => {
  it('holds its own upstream subscription and carries sminos’s snapshot, then every plane message of the session: its host messages, the session-wide ones and the pending set', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    s.send({ t: 'pending', project: PROJECT, raised: [RAISED] });
    const a = await openRemote(f, org.a1, org.A);
    const ask = subscribe(a, 's1', { lane: 'A', id: 'la-1' });
    const up = await serve(s);
    expect(up).toMatchObject({ t: 'subscribe', project: PROJECT, session: 'la-1', agentId: null });
    const subbed = await ask;
    expect(subbed).toMatchObject({ t: 'subbed', mode: 'snapshot', epoch: up.sub, seq: 0 });
    const snap = await snapshot(a, 's1');
    expect(snap).toMatchObject({ epoch: up.sub, seq: 0, body: { kind: 'snapshot', n: 0, body: { host: [{ id: { writer: 'mini/host', seq: 1 } }] } } });
    const next = counter();
    s.send(next(up.sub as string, 'row', { row: { uuid: 'r2' }, agentId: null }));
    s.send(next(up.sub as string, 'host', { id: { writer: 'mini/host', seq: 2 }, event: { kind: 'message', text: 'done' } }));
    s.send(plane('settled', { request: 'toolu_1', winner: 'terminal', outcome: 'allow', by: 'terminal' }));
    s.send(plane('host', { event: { kind: 'message', writer: 'mini/host', seq: 2 } })); // outside any subscription: not again
    s.send(plane('presence', { record: null, bridge: true }, { session: 'la-other' })); // another session's
    await until(() => evs(a, 's1').length === 4, 'the stream');
    expect(kinds(a, 's1')).toEqual(['raised', 'row', 'host', 'settled']);
    expect(evs(a, 's1').map((e) => [e.epoch, e.seq])).toEqual([1, 2, 3, 4].map((n) => [up.sub, n]));
  });

  it('replays from its ring when the device resumes inside it, after a forced drop: nothing lost, nothing twice', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const ask = subscribe(a, 's1', { lane: 'A', id: 'la-1' });
    const up = await serve(s);
    await ask;
    const next = counter();
    for (let i = 0; i < 3; i++) s.send(next(up.sub as string, 'row', { row: { uuid: `a${i}` } }));
    await until(() => evs(a, 's1').length === 3, 'the first rows');
    const cursor = { epoch: up.sub as string, seq: evs(a, 's1').at(-1)!.seq };
    drop(a);
    for (let i = 0; i < 2; i++) s.send(next(up.sub as string, 'row', { row: { uuid: `b${i}` } }));
    const b = await openRemote(f, org.a1, org.A);
    expect(await subscribe(b, 's1', { lane: 'A', id: 'la-1' }, { cursor })).toMatchObject({ mode: 'replay', ...cursor });
    s.send(next(up.sub as string, 'row', { row: { uuid: 'c0' } }));
    await until(() => evs(b, 's1').length === 3, 'the replay and the live row');
    expect(evs(b, 's1').map((e) => [e.seq, (e.body as { body: { row: { uuid: string } } }).body.row.uuid])).toEqual([
      [4, 'b0'],
      [5, 'b1'],
      [6, 'c0'],
    ]);
    expect(s.received.filter((x) => x.t === 'subscribe')).toHaveLength(1);
  });

  it('answers a resume whose cursor the ring no longer holds with a snapshot under a fresh upstream subscription', async () => {
    const f = await startEndpoint(org, started, { subscriptions: { ringBytes: 2048 } });
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const ask = subscribe(a, 's1', { lane: 'A', id: 'la-1' });
    const up = await serve(s);
    await ask;
    const next = counter();
    s.send(next(up.sub as string, 'row', { row: { uuid: 'a0' } }));
    await until(() => evs(a, 's1').length === 1, 'a row');
    const cursor = { epoch: up.sub as string, seq: 1 };
    drop(a);
    for (let i = 0; i < 20; i++) s.send(next(up.sub as string, 'row', { row: { uuid: `b${i}`, text: 'x'.repeat(200) } }));
    await new Promise((r) => setTimeout(r, 50));
    const b = await openRemote(f, org.a1, org.A);
    const again = subscribe(b, 's1', { lane: 'A', id: 'la-1' }, { cursor });
    const fresh = await serve(s);
    expect(fresh.sub).not.toBe(up.sub);
    expect(await again).toMatchObject({ mode: 'snapshot', epoch: fresh.sub, seq: 0 });
    await s.next((x) => x.t === 'unsubscribe' && x.sub === up.sub, 'the old upstream ended');
  });

  it('answers every resume after an endpoint restart with a snapshot (the rings are gone)', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const ask = subscribe(a, 's1', { lane: 'A', id: 'la-1' });
    const up = await serve(s);
    await ask;
    s.close();
    await f.endpoint.stop();
    started.splice(started.indexOf(f), 1);
    const g = await startEndpoint(org, started, { services: f.services, chain: f.chain, key: f.key });
    const t = await sminos(g);
    const b = await openRemote(g, org.a1, org.A);
    const again = subscribe(b, 's1', { lane: 'A', id: 'la-1' }, { cursor: { epoch: up.sub as string, seq: 0 } });
    const fresh = await serve(t);
    expect(await again).toMatchObject({ mode: 'snapshot', epoch: fresh.sub, seq: 0 });
  });

  it('ends its upstream subscription when the resume window passes, and a later resume is a snapshot', async () => {
    const f = await startEndpoint(org, started, { subscriptions: { resumeMs: 150 } });
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const ask = subscribe(a, 's1', { lane: 'A', id: 'la-1' });
    const up = await serve(s);
    await ask;
    drop(a);
    await new Promise((r) => setTimeout(r, 60));
    expect(s.received.some((x) => x.t === 'unsubscribe')).toBe(false);
    await s.next((x) => x.t === 'unsubscribe' && x.sub === up.sub && x.project === PROJECT, 'the upstream ended after the window');
    const b = await openRemote(f, org.a1, org.A);
    const again = subscribe(b, 's1', { lane: 'A', id: 'la-1' }, { cursor: { epoch: up.sub as string, seq: 0 } });
    const fresh = await serve(s);
    expect(await again).toMatchObject({ mode: 'snapshot', epoch: fresh.sub });
  });

  it('moves to a snapshot when the device’s credit is out for longer than its ring holds', async () => {
    const f = await startEndpoint(org, started, { subscriptions: { ringBytes: 4096, backlogBytes: 4096 } });
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const ask = subscribe(a, 's1', { lane: 'A', id: 'la-1' }, { credit: 1 });
    const up = await serve(s);
    await ask;
    await snapshot(a, 's1');
    const next = counter();
    for (let i = 0; i < 40; i++) s.send(next(up.sub as string, 'row', { row: { uuid: `r${i}`, text: 'y'.repeat(200) } }));
    const fresh = await serve(s);
    await s.next((x) => x.t === 'unsubscribe' && x.sub === up.sub, 'the old upstream ended');
    await a.channel.send({ t: 'credit', sub: 's1', bytes: 1024 * 1024 });
    await waitFor(a, (m) => m.t === 'subbed' && m.sub === 's1' && m.epoch === fresh.sub && m.mode === 'snapshot', 'a snapshot under the fresh upstream');
  });

  it('ends when RL10 to sminos goes', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const ask = subscribe(a, 's1', { lane: 'A', id: 'la-1' });
    await serve(s);
    await ask;
    s.close();
    await waitFor(a, (m) => m.t === 'ended' && m.sub === 's1' && m.reason === 'unavailable', 'ended');
  });
});

describe('a lane A `cards` subscription', () => {
  it('carries the session’s pending requests and their settlement, never its host messages or its transcript, and needs no upstream subscription', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    s.send({ t: 'pending', project: PROJECT, raised: [RAISED, { ...RAISED, request: 'toolu_x', session: 'la-other' }] });
    const a = await openRemote(f, org.a1, org.A);
    // A full subscriber beside it, which sees the host message the cards one doesn't.
    const fullAsk = subscribe(a, 'full', { lane: 'A', id: 'la-1' });
    const up = await serve(s);
    await fullAsk;
    expect(await subscribe(a, 'c1', { lane: 'A', id: 'la-1' }, { view: 'cards' })).toMatchObject({ mode: 'snapshot', seq: 0 });
    expect((await snapshot(a, 'c1')).body).toEqual({ raised: [RAISED] });
    s.send(counter()(up.sub as string, 'host', { id: { writer: 'mini/host', seq: 3 }, event: { kind: 'message' } }));
    s.send(plane('host', { event: { kind: 'message', writer: 'mini/host', seq: 3 } }));
    s.send(plane('raised', { ...RAISED, request: 'toolu_2' }));
    s.send(plane('settled', { request: 'toolu_1', winner: 'web', outcome: 'allow', by: org.A }));
    s.send(plane('presence', { record: null, bridge: false }));
    await until(() => evs(a, 'c1').length === 2, 'the raise and the settlement');
    await until(() => kinds(a, 'full').includes('host'), 'the full subscriber’s host message');
    expect(kinds(a, 'c1')).toEqual(['raised', 'settled']);
    expect(of(a, 'c1').every((m) => m.t !== 'ev' || !['host', 'row', 'snapshot', 'presence'].includes((m.body as { kind: string }).kind))).toBe(true);
    expect(s.received.filter((x) => x.t === 'subscribe')).toHaveLength(1);
  });
});

describe('access, re-checked whenever it can change', () => {
  it('ends a live subscription when the session is made private, drops its upstream, and refuses its resume', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f, [laneAMember({ owners: [org.A], shares: [{ member: org.B, grade: 'view' }] })]);
    const b = await openRemote(f, org.b1, org.B);
    const ask = subscribe(b, 's1', { lane: 'A', id: 'la-1' });
    const up = await serve(s);
    await ask;
    s.send({ t: 'member', ...laneAMember({ owners: [org.A], access: 'private' }) });
    await waitFor(b, (m) => m.t === 'ended' && m.sub === 's1' && m.reason === 'removed', 'ended removed');
    await s.next((x) => x.t === 'unsubscribe' && x.sub === up.sub, 'the upstream dropped');
    expect(await subscribe(b, 's2', { lane: 'A', id: 'la-1' }, { cursor: { epoch: up.sub as string, seq: 0 } })).toMatchObject({ t: 'ended', reason: 'grade' });
  });

  it('drops a retained cursor whose member lost the session while away, so a resume can’t restore it', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f, [laneAMember({ owners: [org.A], shares: [{ member: org.B, grade: 'view' }] })]);
    const b = await openRemote(f, org.b1, org.B);
    const ask = subscribe(b, 's1', { lane: 'A', id: 'la-1' });
    const up = await serve(s);
    await ask;
    drop(b);
    await new Promise((r) => setTimeout(r, 30));
    s.send({ t: 'member', ...laneAMember({ owners: [org.A] }) });
    await s.next((x) => x.t === 'unsubscribe' && x.sub === up.sub, 'the retained upstream dropped');
  });
});
