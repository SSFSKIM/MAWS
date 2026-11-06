// Lane A's subscriptions (O10 M8; RL3; acceptance 2's lane A half against the fake sminos): the endpoint mints the
// cursor. Each remote subscription holds its own upstream sminos subscription over RL10 (`subscribe`), whose id is the
// cursor's epoch; the endpoint numbers what the subscription carries (sminos's snapshot at 0, then every plane message of
// the session in arrival order) and keeps the last of it in a ring, so a resume inside the ring is a `replay` and any
// other a `snapshot` under a fresh upstream subscription. A dropped channel's upstream outlives it for the resume window.
// A `full` subscription carries every plane message sminos sends for the session, its `host` messages among them; a
// `cards` one only the session's pending requests and their settlement.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FakeSminos, Frame } from './rl10/fake-sminos';
import { counter, drop, evs, laneAMember, makeOrg, of, openRemote, plane, PROJECT, serve, snapshot, snapshots, sminos, startEndpoint, stopAll, subscribe, until, waitFor, type Fixture, type Msg, type Org, type Remote } from './sub-harness';

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
    expect((await snapshot(a, 'c1')).body).toEqual({ raised: [RAISED], launch: 'L1' });
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

// ---- Under pressure (O10 M8 review round 1) -----------------------------------------------------------------------------

const MiB = 1024 * 1024;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a lane A subscription under pressure', () => {
  it('starts over under a fresh upstream when more session-wide messages come before sminos’s snapshot than it holds', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const ask = subscribe(a, 's1', { lane: 'A', id: 'la-1' });
    const first = await s.next((x) => x.t === 'subscribe', 'the first upstream');
    expect(await ask).toMatchObject({ mode: 'snapshot', epoch: first.sub });
    // sminos takes its time opening (a bridge it waits on); the session's operations go on meanwhile.
    for (let i = 0; i < 300; i++) s.send(plane('op', { opId: `op-${i}`, state: 'done' }));
    await s.next((x) => x.t === 'unsubscribe' && x.sub === first.sub, 'the first upstream ended');
    const second = await serve(s);
    await waitFor(a, (m) => m.t === 'subbed' && m.sub === 's1' && m.epoch === second.sub && m.mode === 'snapshot', 'a snapshot under the fresh upstream');
  });

  it('keeps a cards subscription’s unsent stream bounded while its credit is out, and ends it in the whole pending set', async () => {
    const f = await startEndpoint(org, started, { subscriptions: { backlogBytes: 64 * 1024 } });
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    expect(await subscribe(a, 'c1', { lane: 'A', id: 'la-1' }, { view: 'cards', credit: 1 })).toMatchObject({ mode: 'snapshot' });
    await until(() => of(a, 'c1').some((m) => m.t === 'snap'), 'the snapshot');
    for (let i = 0; i < 1000; i++) s.send(plane('raised', { ...RAISED, request: `toolu_${i}`, input: { command: 'x'.repeat(1024) } }));
    await until(() => f.endpoint.planeA.pending.of('la-1').length === 1000, 'every raise read', 10_000);
    // What the device holds once its credit comes: the last snapshot, then the raises after it.
    const held = () => {
      const msgs = of(a, 'c1');
      const at = msgs.findLastIndex((m) => m.t === 'snap' && m.page === 0);
      const snap = snapshots(a, 'c1').at(-1) as { raised: Array<{ request: string }> };
      const after = msgs.slice(at).filter((m) => m.t === 'ev').map((m) => ((m.body as { body: { request: string } }).body.request));
      return new Set([...snap.raised.map((r) => r.request), ...after]);
    };
    for (let i = 0; i < 20 && held().size < 1000; i++) {
      await a.channel.send({ t: 'credit', sub: 'c1', bytes: 4 * MiB });
      await sleep(40);
    }
    expect(held().size).toBe(1000);
    expect(evs(a, 'c1').length).toBeLessThan(1000);
  });

  it('brings a cards subscription current after RL10 comes back with a pending set it changed while away', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    s.send({ t: 'pending', project: PROJECT, raised: [] });
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 'c1', { lane: 'A', id: 'la-1' }, { view: 'cards' });
    expect((await snapshot(a, 'c1')).body).toEqual({ raised: [], launch: 'L1' });
    s.send(plane('raised', RAISED));
    await until(() => evs(a, 'c1').length === 1, 'the raise');
    // RL10 goes; the request settles while it is away; sminos comes back and restates its project's pending set.
    s.close();
    await sleep(50);
    const again = await sminos(f);
    again.send({ t: 'pending', project: PROJECT, raised: [] });
    await until(() => snapshots(a, 'c1').length === 2, 'a snapshot of the restated set');
    expect(snapshots(a, 'c1').at(-1)).toEqual({ raised: [], launch: 'L1' });
  });
});

describe('a lane A `cards` subscription’s launch (O13’s phone)', () => {
  it('carries the session’s launch beside its pending set, sent again when the session is launched again, null with no bridge', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    s.send({ t: 'pending', project: PROJECT, raised: [RAISED] });
    const a = await openRemote(f, org.a1, org.A);
    await subscribe(a, 'c1', { lane: 'A', id: 'la-1' }, { view: 'cards' });
    // What a web-cards act's context needs ({lane: 'A', session, launch}): the phone sees no member frame of its own.
    expect((await snapshot(a, 'c1')).body).toEqual({ raised: [RAISED], launch: 'L1' });
    s.send({ t: 'member', ...laneAMember({ launch: 'L2' }) });
    await until(() => snapshots(a, 'c1').length === 2, 'a snapshot under the new launch');
    expect(snapshots(a, 'c1').at(-1)).toEqual({ raised: [RAISED], launch: 'L2' });
    // A member change that leaves the launch as it was sends nothing.
    s.send({ t: 'member', ...laneAMember({ launch: 'L2', title: 'renamed' }) });
    await sleep(60);
    expect(snapshots(a, 'c1')).toHaveLength(2);
    // A session with no bridge has no launch: null, and an act on it is refused `unavailable` anyway.
    const bridgeless = laneAMember();
    delete bridgeless.launch;
    s.send({ t: 'member', ...bridgeless });
    await until(() => snapshots(a, 'c1').length === 3, 'a snapshot with no launch');
    expect(snapshots(a, 'c1').at(-1)).toEqual({ raised: [RAISED], launch: null });
  });
});

describe('a lane A `cards` subscription whose member frame moves its launch and its access at once', () => {
  it('sends nothing of the new record before its access is decided: one frame that relaunches and drops the viewer ends it with no snapshot', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f, [laneAMember({ owners: [org.B] })]);
    s.send({ t: 'pending', project: PROJECT, raised: [RAISED] });
    const b = await openRemote(f, org.b1, org.B);
    await subscribe(b, 'c1', { lane: 'A', id: 'la-1' }, { view: 'cards' });
    expect((await snapshot(b, 'c1')).body).toEqual({ raised: [RAISED], launch: 'L1' });
    s.send({ t: 'member', ...laneAMember({ owners: [org.A], launch: 'L2' }) });
    await waitFor(b, (m) => m.t === 'ended' && m.sub === 'c1' && m.reason === 'removed', 'ended removed');
    await sleep(30);
    expect(snapshots(b, 'c1')).toEqual([{ raised: [RAISED], launch: 'L1' }]);
  });

  it('sends the new launch once its access is decided and holds', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f, [laneAMember({ owners: [org.B] })]);
    const b = await openRemote(f, org.b1, org.B);
    await subscribe(b, 'c1', { lane: 'A', id: 'la-1' }, { view: 'cards' });
    await snapshot(b, 'c1');
    s.send({ t: 'member', ...laneAMember({ owners: [org.B], launch: 'L2' }) });
    await until(() => snapshots(b, 'c1').length === 2, 'the new launch');
    expect(snapshots(b, 'c1').at(-1)).toEqual({ raised: [], launch: 'L2' });
  });
});

// ---- One subagent's transcript (2026-11-06, `rl2.agent-scope`, RL2 1.11) ----------------------------------------------

/** A call's result on `r`'s channel. */
async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}

/** sminos's snapshot for the upstream `up`, at n 0: one row of its transcript, `more` before it. */
const served = (s: FakeSminos, up: Frame, row: string) => s.send(plane('snapshot', { rows: [{ uuid: row }], more: true, subagents: [], presence: { record: null, bridge: true }, streaming: [] }, { sub: up.sub as string, n: 0 }));

describe('a lane A subscription of one subagent’s transcript', () => {
  const AGENT = 'ab5e2e00000000001';

  it('is listed in the endpoint’s handshake', async () => {
    const f = await startEndpoint(org, started);
    const a = await openRemote(f, org.a1, org.A);
    expect(a.channel.peer.capabilities).toContain('rl2.agent-scope');
  });

  it('holds an upstream subscription of its own scoped to the agent beside the main one’s, and carries that upstream’s own stream alone', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    s.send({ t: 'pending', project: PROJECT, raised: [RAISED] });
    const a = await openRemote(f, org.a1, org.A);
    const mainAsk = subscribe(a, 'main', { lane: 'A', id: 'la-1' });
    const main = await s.next((x) => x.t === 'subscribe', 'the main upstream');
    expect(main).toMatchObject({ session: 'la-1', agentId: null });
    served(s, main, 'm1');
    await mainAsk;
    const agentAsk = subscribe(a, 'agent', { lane: 'A', id: 'la-1' }, { agentId: AGENT });
    const agent = await s.next((x) => x.t === 'subscribe', 'the agent’s upstream');
    expect(agent).toMatchObject({ t: 'subscribe', project: PROJECT, session: 'la-1', agentId: AGENT });
    expect(agent.sub).not.toBe(main.sub);
    expect(await agentAsk).toMatchObject({ t: 'subbed', mode: 'snapshot', epoch: agent.sub, seq: 0 });
    // what comes before sminos's snapshot of it waits for nothing of the session's
    s.send(plane('presence', { record: null, bridge: true }));
    served(s, agent, 'g1');
    expect((await snapshot(a, 'agent')).body).toMatchObject({ kind: 'snapshot', body: { rows: [{ uuid: 'g1' }] } });
    s.send(counter()(agent.sub as string, 'row', { row: { uuid: 'g2' }, agentId: AGENT }));
    s.send(counter()(main.sub as string, 'row', { row: { uuid: 'm2' }, agentId: null }));
    s.send(plane('raised', { ...RAISED, request: 'toolu_2' }));
    s.send(plane('settled', { request: 'toolu_1', winner: 'terminal', outcome: 'allow', by: 'terminal' }));
    await until(() => kinds(a, 'main').includes('settled'), 'the main stream’s settlement');
    await sleep(30);
    expect(kinds(a, 'agent')).toEqual(['row']);
    expect(evs(a, 'agent').map((e) => [e.epoch, e.seq])).toEqual([[agent.sub, 1]]);
    expect(kinds(a, 'main')).toEqual(['raised', 'presence', 'row', 'raised', 'settled']);
  });

  it('asks rows, output and read of the agent’s own transcript, and refuses its diff, sending nothing down', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const ask = subscribe(a, 'agent', { lane: 'A', id: 'la-1' }, { agentId: AGENT });
    const up = await s.next((x) => x.t === 'subscribe', 'the agent’s upstream');
    served(s, up, 'g1');
    await ask;
    expect(await call(a, 'sminos.rows', { session: 'la-1', sub: 'agent', before: 'g1', limit: 50 })).toMatchObject({ ok: true });
    expect(await s.next((x) => x.t === 'rows', 'rows down')).toEqual({ t: 'rows', project: PROJECT, session: 'la-1', agentId: AGENT, sub: up.sub, before: 'g1', limit: 50 });
    expect(await call(a, 'sminos.output', { session: 'la-1', sub: 'agent', taskId: 'bash_1', tail: 4096 })).toMatchObject({ ok: true });
    expect(await s.next((x) => x.t === 'output', 'output down')).toEqual({ t: 'output', project: PROJECT, session: 'la-1', agentId: AGENT, sub: up.sub, taskId: 'bash_1', tail: 4096 });
    expect(await call(a, 'sminos.read', { session: 'la-1', sub: 'agent', id: 'q1', what: 'status' })).toMatchObject({ ok: true });
    expect(await s.next((x) => x.t === 'read', 'read down')).toEqual({ t: 'read', project: PROJECT, session: 'la-1', agentId: AGENT, sub: up.sub, id: 'q1', what: 'status' });
    expect(await call(a, 'sminos.diff', { session: 'la-1', sub: 'agent' })).toMatchObject({ ok: false, error: { code: 'malformed' } });
    await sleep(30);
    expect(s.received.filter((x) => x.t === 'diff')).toEqual([]);
  });

  it('resumes its own cursor as a replay, and answers a cursor of the session’s other scope with a snapshot under a fresh upstream', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const mainAsk = subscribe(a, 'main', { lane: 'A', id: 'la-1' });
    const main = await s.next((x) => x.t === 'subscribe', 'the main upstream');
    served(s, main, 'm1');
    await mainAsk;
    const agentAsk = subscribe(a, 'agent', { lane: 'A', id: 'la-1' }, { agentId: AGENT });
    const agent = await s.next((x) => x.t === 'subscribe', 'the agent’s upstream');
    served(s, agent, 'g1');
    await agentAsk;
    const next = counter();
    s.send(next(agent.sub as string, 'row', { row: { uuid: 'g2' }, agentId: AGENT }));
    await until(() => evs(a, 'agent').length === 1, 'the agent’s row');
    drop(a);
    s.send(next(agent.sub as string, 'row', { row: { uuid: 'g3' }, agentId: AGENT }));
    const b = await openRemote(f, org.a1, org.A);
    expect(await subscribe(b, 'agent', { lane: 'A', id: 'la-1' }, { agentId: AGENT, cursor: { epoch: agent.sub as string, seq: 1 } })).toMatchObject({ mode: 'replay', epoch: agent.sub, seq: 1 });
    await until(() => evs(b, 'agent').length === 1, 'the replay');
    expect((evs(b, 'agent')[0].body as { body: { row: { uuid: string } } }).body.row.uuid).toBe('g3');
    // the main upstream's cursor, asked for the agent: never its stream, and the main upstream left to its own resume
    const crossed = subscribe(b, 'other', { lane: 'A', id: 'la-1' }, { agentId: AGENT, cursor: { epoch: main.sub as string, seq: 0 } });
    const fresh = await s.next((x) => x.t === 'subscribe' && x.sub !== main.sub && x.sub !== agent.sub, 'a fresh upstream of the agent');
    expect(fresh).toMatchObject({ agentId: AGENT });
    expect(await crossed).toMatchObject({ mode: 'snapshot', epoch: fresh.sub, seq: 0 });
    // and the agent's cursor, asked for the main transcript: a fresh main upstream; the agent's goes on under its own sub
    const back = subscribe(b, 'main2', { lane: 'A', id: 'la-1' }, { cursor: { epoch: agent.sub as string, seq: 2 } });
    const mainAgain = await s.next((x) => x.t === 'subscribe' && x.agentId === null, 'a fresh main upstream');
    expect(await back).toMatchObject({ mode: 'snapshot', epoch: mainAgain.sub, seq: 0 });
    expect(s.received.filter((x) => x.t === 'unsubscribe').map((x) => x.sub)).toEqual([]);
    expect(await subscribe(b, 'main', { lane: 'A', id: 'la-1' }, { cursor: { epoch: main.sub as string, seq: 0 } })).toMatchObject({ mode: 'replay', epoch: main.sub, seq: 0 });
  });

  it('is authorized as the session’s main transcript is: refused where it is, and ended `removed` with it when the session is made private', async () => {
    const f = await startEndpoint(org, started);
    const s = await sminos(f, [laneAMember({ owners: [org.A], shares: [{ member: org.B, grade: 'view' }] }), laneAMember({ session: 'la-p', alias: 'p', owners: [org.A] })]);
    const b = await openRemote(f, org.b1, org.B);
    expect(await subscribe(b, 'shut-main', { lane: 'A', id: 'la-p' })).toMatchObject({ t: 'ended', reason: 'grade' });
    expect(await subscribe(b, 'shut-agent', { lane: 'A', id: 'la-p' }, { agentId: AGENT })).toMatchObject({ t: 'ended', reason: 'grade' });
    const ask = subscribe(b, 'agent', { lane: 'A', id: 'la-1' }, { agentId: AGENT });
    const up = await s.next((x) => x.t === 'subscribe', 'the agent’s upstream');
    served(s, up, 'g1');
    await ask;
    s.send({ t: 'member', ...laneAMember({ owners: [org.A], access: 'private' }) });
    await waitFor(b, (m) => m.t === 'ended' && m.sub === 'agent' && m.reason === 'removed', 'ended removed');
    await s.next((x) => x.t === 'unsubscribe' && x.sub === up.sub, 'the upstream dropped');
    expect(await subscribe(b, 'agent2', { lane: 'A', id: 'la-1' }, { agentId: AGENT, cursor: { epoch: up.sub as string, seq: 0 } })).toMatchObject({ t: 'ended', reason: 'grade' });
    expect(s.received.filter((x) => x.t === 'subscribe')).toHaveLength(1);
  });
});
