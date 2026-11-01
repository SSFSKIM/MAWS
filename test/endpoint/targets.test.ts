// Lane B placement and the asker's ref (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Lane B
// placement goes through the spine's record" and "A `ClientRef` per channel"). A request naming an `appSessionId` is
// placed by the spine's record first (`session.get`, whose `engineSessionId` keys the session's member record), so a
// session the engine host holds no row for (released as idle, or the host parked) is still placed; the engine host's
// `session.status` answers only when the spine gives no record with an engine session, and a spine that fails is
// `unavailable`. Where the engine host holds a live row, the engine session placement authorized against must be the one
// the request runs on (a read, a subscription's opening, an act), else `unavailable`. And each channel is one asker on
// the machine: a `ClientRef` minted at its admission, carried by every `dispatch` its requests make, ended at its close.
//
// P5 O12 M11 (docs/doperpowers/plans/2026-10-27-p5-o12-sminos-owners.md, M11's Decisions and Acceptance 10): a lane B
// session a member spawned (the spine record's `launchedBy`) is that member's until sminos's record of it reaches the
// endpoint, for every reader (a call, an act, a subscription, a query) and nobody else's; then the record decides, a
// record arriving mid-decision taking the decision again; and once a record was seen for the app session (the handed-off
// mark on disk), a missing one is `grade` for everyone, across an endpoint restart, a `/clear` and a `gone`.
import * as fs from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ClientRef } from '@shared/ipc/client';
import { Members, type Marks } from '../../src/endpoint/rl10/members';
import type { RecordSource, SessionRecord, SessionTarget } from '../../src/endpoint/sources';
import { EndpointState } from '../../src/endpoint/state/store';
import { fakeServices } from './fake-services';
import { act, CHECKOUT, done, evs, laneAMember, makeOrg, of, openRemote, PROJECT, Records, sminos, startEndpoint, stopAll, subscribe, until, waitFor, type Fixture, type HostSession, type Msg, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

async function call(r: Remote, name: string, input: unknown): Promise<Msg> {
  const id = `c${r.inbox.length}-${Math.random().toString(36).slice(2, 8)}`;
  await r.channel.send({ t: 'call', id, name, input });
  return waitFor(r, (m) => m.t === 'result' && m.id === id, `the result of ${name}`);
}

/** A lane B session the machine's owners own, its member record under `engine`. */
function owned(f: Fixture, appSessionId: string, engine: string): void {
  f.records.set({ lane: 'B', session: engine, owners: ['@machine'] }, appSessionId);
}

const statusReads = (f: Fixture, appSessionId: string) => f.host.calls.filter((c) => c.name === 'session.status' && (c.input as { appSessionId?: string }).appSessionId === appSessionId);

describe('lane B placement', () => {
  it('places a session by the spine’s record when the engine host holds no row for it (released, or the host parked)', async () => {
    const f = await startEndpoint(org, started);
    const record = f.spine.set('app-r', 'eng-r', { title: 'released' });
    owned(f, 'app-r', 'eng-r');
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'session.get', { appSessionId: 'app-r' })).toMatchObject({ ok: true, output: record });
    // One status read, the live check's, which finds no row: the record places it.
    expect(statusReads(f, 'app-r')).toHaveLength(1);
    // A member with no rank on it is refused as for any session, saying nothing of whether it exists.
    const b = await openRemote(f, org.b1, org.B);
    expect(await call(b, 'session.get', { appSessionId: 'app-r' })).toMatchObject({ ok: false, error: { code: 'grade' } });
  });

  it('answers a session neither the spine nor the engine host knows as unknown (`grade`)', async () => {
    const f = await startEndpoint(org, started);
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'session.get', { appSessionId: 'app-nowhere' })).toMatchObject({ ok: false, error: { code: 'grade' } });
  });

  it('falls back to the engine host for a session the spine has no record of, or one whose record has no engine session yet', async () => {
    const f = await startEndpoint(org, started);
    f.host.add('app-1');
    owned(f, 'app-1', 'eng-app-1');
    f.host.add('app-fresh', 'eng-fresh');
    f.spine.set('app-fresh', null); // launched; the index hasn't heard its engine's id yet
    owned(f, 'app-fresh', 'eng-fresh');
    f.spine.set('app-never', null); // never launched
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: true, output: { engineSessionId: 'eng-app-1' } });
    expect(await call(a, 'session.status', { appSessionId: 'app-fresh' })).toMatchObject({ ok: true, output: { engineSessionId: 'eng-fresh' } });
    expect(await call(a, 'session.get', { appSessionId: 'app-never' })).toMatchObject({ ok: false, error: { code: 'grade' } });
  });

  it('is `unavailable`, logged, while the spine fails (an error, or a dispatch that throws), never falling back to the engine host', async () => {
    const f = await startEndpoint(org, started);
    f.host.add('app-1');
    owned(f, 'app-1', 'eng-app-1');
    const a = await openRemote(f, org.a1, org.A);
    f.host.fail('session.get');
    expect(await call(a, 'session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(f.services.lines.filter((line) => line.includes('app-1') && line.includes('host_unavailable'))).toHaveLength(1);
    f.host.heal('session.get');
    const spine = f.spine.dispatch.bind(f.spine);
    f.spine.dispatch = (name, input, client) => (name === 'session.get' ? Promise.reject(new Error('the index is broken')) : spine(name, input, client));
    expect(await call(a, 'session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(f.services.lines.filter((line) => line.includes('app-1') && line.includes('the index is broken'))).toHaveLength(1);
    expect(statusReads(f, 'app-1')).toEqual([]);
  });

  it('is `unavailable` while the engine host can’t answer, whether it places the session or checks its live row', async () => {
    const f = await startEndpoint(org, started);
    f.host.add('app-1');
    owned(f, 'app-1', 'eng-app-1');
    f.host.add('app-2', 'eng-2');
    f.spine.set('app-2', 'eng-2');
    owned(f, 'app-2', 'eng-2');
    const a = await openRemote(f, org.a1, org.A);
    f.host.fail('session.status');
    expect(await call(a, 'session.queue.list', { appSessionId: 'app-1' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await call(a, 'session.queue.list', { appSessionId: 'app-2' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });

  // P5 O7 M4 fix wave 2: the host's absence is the machine's condition, said alike for every id before anyone's rank, so a
  // caller who holds nothing tells an indexed session from an absent id by no answer: not a call's, a subscription's or an
  // engine host act's (whose placement reads the live row too).
  it('answers a caller below view alike for an indexed session and an absent id while the engine host can’t answer', async () => {
    const f = await startEndpoint(org, started);
    const s = f.host.add('app-1');
    f.spine.set('app-1', s.engineSessionId);
    owned(f, 'app-1', s.engineSessionId!);
    const b = await openRemote(f, org.b1, org.B);
    f.host.fail('session.status');
    const answers = async (app: string) => {
      const read = await call(b, 'session.queue.list', { appSessionId: app });
      const sub = await subscribe(b, `s-${app}`, { lane: 'B', id: app });
      const send = await act(b, b.device.action({ machine: f.ref, action: 'session.send', session: app, context: { lane: 'B', launchId: s.launchId, engineSessionId: s.engineSessionId! }, args: { appSessionId: app, content: 'hi' } }));
      return [(read.error as { code: string }).code, sub.t, sub.reason, send];
    };
    const indexed = await answers('app-1');
    expect(indexed).toEqual(['unavailable', 'ended', 'unavailable', 'unavailable']);
    expect(await answers('app-absent')).toEqual(indexed);
    expect(f.host.runs).toEqual([]);
  });

  it('places a `machine` act on a released session, and the query of it, by the record', async () => {
    const f = await startEndpoint(org, started);
    f.spine.set('app-r', 'eng-r');
    owned(f, 'app-r', 'eng-r');
    const a = await openRemote(f, org.a1, org.A);
    const acquire = a.device.action({ machine: f.ref, action: 'session.acquire', args: { appSessionId: 'app-r', reason: 'send' } });
    const from = a.inbox.length;
    expect(await act(a, acquire)).toBe('ok');
    expect(await done(a, acquire, from)).toEqual({ state: 'done', result: { status: 'ready', appSessionId: 'app-r', launched: true, joined: false } });
    expect(f.spine.acquired).toEqual(['app-r']);
    await a.channel.send({ t: 'query', opId: acquire.opId, opCreated: acquire.opCreated, executor: 'machine' });
    expect(await waitFor(a, (m) => m.t === 'queried' && m.opId === acquire.opId, 'the query’s answer')).toMatchObject({ state: 'done', outcome: { state: 'done' } });
  });
});

describe('the engine session authorized is the one the request runs on', () => {
  /** app-1 runs eng-new on the engine host while the index still names eng-old; each engine session is another member's. */
  async function lagging() {
    const f = await startEndpoint(org, started);
    const s = f.host.add('app-1', 'eng-new');
    f.spine.set('app-1', 'eng-old');
    f.records.set({ lane: 'B', session: 'eng-old', owners: [org.B], access: 'private' }, 'app-1');
    f.records.set({ lane: 'B', session: 'eng-new', owners: [org.A], access: 'private' }, 'app-1');
    return { f, s, a: await openRemote(f, org.a1, org.A), b: await openRemote(f, org.b1, org.B) };
  }

  it('a read (engine host’s or the spine’s), a subscription’s opening and an act on a session whose live engine session the index hasn’t caught up with are `unavailable`', async () => {
    const { f, s, b } = await lagging();
    expect(await call(b, 'session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await call(b, 'session.events', { appSessionId: 'app-1', afterSeq: null, limit: 10 })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await call(b, 'session.get', { appSessionId: 'app-1' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(await subscribe(b, 's1', { lane: 'B', id: 'app-1' })).toMatchObject({ t: 'ended', reason: 'unavailable' });
    const send = b.device.action({ machine: f.ref, action: 'session.send', session: 'app-1', context: { lane: 'B', launchId: s.launchId, engineSessionId: s.engineSessionId! }, args: { appSessionId: 'app-1', content: 'not yours' } });
    expect(await act(b, send)).toBe('unavailable');
    const acquire = b.device.action({ machine: f.ref, action: 'session.acquire', args: { appSessionId: 'app-1', reason: 'send' } });
    expect(await act(b, acquire)).toBe('unavailable');
    // Nothing reached an executor: no read past placement, no stream, no op.
    expect(f.host.calls.filter((c) => ['session.events', 'host.op', 'machine.op'].includes(c.name))).toEqual([]);
    expect(f.host.runs).toEqual([]);
    expect(f.spine.acquired).toEqual([]);
  });

  // P5 O7 M4 fix wave 1: the lag is said only to a caller who stands on the recorded engine session. One who owns only the
  // live engine session is placed on the recorded one like anyone, and holds nothing there: `grade`, as for a session
  // they can't see, and nothing past placement is read for them.
  it('answers `grade`, not `unavailable`, to a caller who owns only the live engine session during the lag', async () => {
    const { f, s, a } = await lagging();
    const from = f.host.calls.length;
    expect(await call(a, 'session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: false, error: { code: 'grade' } });
    expect(await call(a, 'session.get', { appSessionId: 'app-1' })).toMatchObject({ ok: false, error: { code: 'grade' } });
    expect(await subscribe(a, 's1', { lane: 'B', id: 'app-1' })).toMatchObject({ t: 'ended', reason: 'grade' });
    const send = a.device.action({ machine: f.ref, action: 'session.send', session: 'app-1', context: { lane: 'B', launchId: s.launchId, engineSessionId: s.engineSessionId! }, args: { appSessionId: 'app-1', content: 'not yet' } });
    expect(await act(a, send)).toBe('grade');
    const acquire = a.device.action({ machine: f.ref, action: 'session.acquire', args: { appSessionId: 'app-1', reason: 'send' } });
    expect(await act(a, acquire)).toBe('grade');
    // Placement's reads only: the record and the live row.
    expect(f.host.calls.slice(from).map((c) => c.name).filter((name) => name !== 'session.get' && name !== 'session.status')).toEqual([]);
    expect(f.host.runs).toEqual([]);
    expect(f.spine.acquired).toEqual([]);
  });

  it('once the index names the live engine session, its own record decides: its owner reads and drives it, the stale record’s owner is refused', async () => {
    const { f, s, a, b } = await lagging();
    f.spine.set('app-1', 'eng-new');
    expect(await call(b, 'session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: false, error: { code: 'grade' } });
    expect(await subscribe(b, 's1', { lane: 'B', id: 'app-1' })).toMatchObject({ t: 'ended', reason: 'grade' });
    expect(await call(a, 'session.status', { appSessionId: 'app-1' })).toMatchObject({ ok: true, output: { engineSessionId: 'eng-new' } });
    expect(await subscribe(a, 's1', { lane: 'B', id: 'app-1' })).toMatchObject({ t: 'subbed' });
    const send = a.device.action({ machine: f.ref, action: 'session.send', session: 'app-1', context: { lane: 'B', launchId: s.launchId, engineSessionId: s.engineSessionId! }, args: { appSessionId: 'app-1', content: 'mine' } });
    const from = a.inbox.length;
    expect(await act(a, send)).toBe('ok');
    expect(await done(a, send, from)).toMatchObject({ state: 'done' });
  });
});

describe('a ClientRef per channel', () => {
  const clientsOf = (f: Fixture, name: string) => f.host.calls.filter((c) => c.name === name).map((c) => c.client);
  const gone = (client: ClientRef | undefined) => {
    let ended = false;
    client?.onGone(() => (ended = true))();
    return ended;
  };

  it('reaches every dispatch a channel’s requests make, one ref per channel, ended at its close', async () => {
    const f = await startEndpoint(org, started);
    const s = f.host.add('app-1');
    owned(f, 'app-1', s.engineSessionId!);
    f.spine.set('app-1', s.engineSessionId);
    const a = await openRemote(f, org.a1, org.A);
    const again = await openRemote(f, org.a1, org.A);
    // Its placement's read and its executor's both carry the channel's ref.
    await call(a, 'session.get', { appSessionId: 'app-1' });
    const first = clientsOf(f, 'session.get').at(-1);
    expect(first?.id).toMatch(/^a1\//);
    expect(clientsOf(f, 'session.get').slice(-2)).toEqual([first, first]);
    await call(again, 'session.get', { appSessionId: 'app-1' });
    const second = clientsOf(f, 'session.get').at(-1);
    expect(second?.id).toMatch(/^a1\//);
    expect(second!.id).not.toBe(first!.id);
    await call(a, 'session.status', { appSessionId: 'app-1' });
    expect(clientsOf(f, 'session.status').at(-1)).toBe(first);
    // An act's executor hears the same asker: the engine host's ledger and the services'.
    const send = a.device.action({ machine: f.ref, action: 'session.send', session: 'app-1', context: { lane: 'B', launchId: s.launchId, engineSessionId: s.engineSessionId! }, args: { appSessionId: 'app-1', content: 'hi' } });
    expect(await act(a, send)).toBe('ok');
    await until(() => clientsOf(f, 'host.op').length > 0, 'the act handed on');
    expect(clientsOf(f, 'host.op').at(-1)).toBe(first);
    const acquire = a.device.action({ machine: f.ref, action: 'session.acquire', args: { appSessionId: 'app-1', reason: 'send' } });
    expect(await act(a, acquire)).toBe('ok');
    await until(() => clientsOf(f, 'machine.op').length > 0, 'the machine act handed on');
    expect(clientsOf(f, 'machine.op').at(-1)).toBe(first);

    expect(gone(first)).toBe(false);
    a.channel.close('closed');
    await until(() => gone(first), 'the closed channel’s ref ended');
    expect(gone(second)).toBe(false);
  });
});

// ---- P5 O12 M11: the spawner as owner ---------------------------------------------------------------------------------

/** Lane B's records as sminos reports them on RL10: the endpoint's own members and their handed-off mark, not the suite's map. */
class SminosRecords extends Records {
  #members: RecordSource | null = null;
  override bindLaneA(source: RecordSource): void {
    super.bindLaneA(source);
    this.#members = source;
  }
  override record(target: SessionTarget): SessionRecord | null {
    return this.#members?.record(target) ?? null;
  }
  handedOff(target: SessionTarget): boolean {
    return this.#members?.handedOff?.(target) ?? true;
  }
}

const launchedBy = (member: string) => ({ member, device: 'b1', opId: 'op-spawn-000000000001', action: null });
/** A lane B session `member` spawned: the spine's record (its `launchedBy`; its engine session, or none yet) and the engine host's live row. */
function spawned(f: Fixture, app: string, member: string, engine: { recorded: string | null; live: string }): HostSession {
  const s = f.host.add(app, engine.live);
  f.spine.set(app, engine.recorded, { launchedBy: launchedBy(member) });
  return s;
}
/** sminos's member frame of a lane B session. */
const laneBMember = (session: string, owners: string[], fields: Record<string, unknown> = {}) => ({
  session, alias: 'spawned', project: PROJECT, lane: 'B', state: 'idle', title: 'spawned', cwd: CHECKOUT, owners, ownersProof: [], origin: { kind: 'maws', requester: owners[0] }, ...fields,
});
const sendOf = (f: Fixture, r: Remote, s: HostSession, content: string) =>
  r.device.action({ machine: f.ref, action: 'session.send', session: s.appSessionId, context: { lane: 'B', launchId: s.launchId, engineSessionId: s.engineSessionId! }, args: { appSessionId: s.appSessionId, content } });
const codeOf = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);
const statusOf = async (r: Remote, app: string) => codeOf(await call(r, 'session.status', { appSessionId: app }));
const markPath = (f: Fixture) => join(f.services.machine.stateDir, 'handed-off.json');
const marksOf = (f: Fixture): { appSessionIds: string[]; engineSessionIds: string[] } => (fs.existsSync(markPath(f)) ? JSON.parse(fs.readFileSync(markPath(f), 'utf8')) : { appSessionIds: [], engineSessionIds: [] });
const handedOff = (f: Fixture): string[] => marksOf(f).appSessionIds;
const withSminosRecords = (f?: Fixture) => ({ records: new SminosRecords(), ...(f && { services: f.services, host: f.host, chain: f.chain, key: f.key }) });

describe('the spawner as owner (P5 O12 M11)', () => {
  it('serves its spawner’s call, read, full subscription, act and query while sminos holds no record, and nobody else, the machine’s owner included', async () => {
    const f = await startEndpoint(org, started, withSminosRecords());
    const s = spawned(f, 'app-s', org.B, { recorded: 'eng-s', live: 'eng-s' });
    const b = await openRemote(f, org.b1, org.B);
    expect(await statusOf(b, 'app-s')).toBe('ok');
    expect(codeOf(await call(b, 'session.events', { appSessionId: 'app-s', afterSeq: null, limit: 10 }))).toBe('ok');
    expect(await subscribe(b, 'sb', { lane: 'B', id: 'app-s' })).toMatchObject({ t: 'subbed' });
    const send = sendOf(f, b, s, 'from the spawner');
    const from = b.inbox.length;
    expect(await act(b, send)).toBe('ok');
    expect(await done(b, send, from)).toMatchObject({ state: 'done' });
    await b.channel.send({ t: 'query', opId: send.opId, opCreated: send.opCreated, executor: 'engine-host' });
    expect(await waitFor(b, (m) => m.t === 'queried' && m.opId === send.opId, 'the query’s answer')).toMatchObject({ state: 'done' });

    const a = await openRemote(f, org.a1, org.A);
    expect(await statusOf(a, 'app-s')).toBe('grade');
    expect(await subscribe(a, 'sa', { lane: 'B', id: 'app-s' })).toMatchObject({ t: 'ended', reason: 'grade' });
    expect(await act(a, sendOf(f, a, s, 'not the spawner'))).toBe('grade');
    expect(f.host.runs.map((run) => run.content)).toEqual(['from the spawner']);
    expect(handedOff(f)).toEqual([]);
  });

  it('lets sminos’s record decide once it arrives: as its owner the spawner keeps everything; under other owners, only what the record grants', async () => {
    const f = await startEndpoint(org, started, withSminosRecords());
    const s = spawned(f, 'app-s', org.B, { recorded: 'eng-s', live: 'eng-s' });
    const b = await openRemote(f, org.b1, org.B);
    expect(await subscribe(b, 'sb', { lane: 'B', id: 'app-s' })).toMatchObject({ t: 'subbed' });
    const sm = await sminos(f, [laneAMember(), laneBMember('eng-s', [org.B])]);
    await until(() => handedOff(f).includes('app-s'), 'the hand-off on disk');
    expect(fs.statSync(markPath(f)).mode & 0o777).toBe(0o600);
    expect(await statusOf(b, 'app-s')).toBe('ok');
    expect(of(b, 'sb').some((m) => m.t === 'ended')).toBe(false);
    const a = await openRemote(f, org.a1, org.A);
    expect(await statusOf(a, 'app-s')).toBe('grade');

    // O8's record actions moved the owners: the spawner keeps the share the record gives, no more
    sm.send({ t: 'member', ...laneBMember('eng-s', [org.C], { shares: [{ member: org.B, grade: 'view' }] }) });
    await until(() => f.endpoint.rl10.members.get('eng-s')?.owners[0] === org.C, 'the moved record');
    expect(await statusOf(b, 'app-s')).toBe('ok');
    expect(await act(b, sendOf(f, b, s, 'no longer mine'))).toBe('grade');
    sm.send({ t: 'member', ...laneBMember('eng-s', [org.C], { access: 'private' }) });
    await until(() => f.endpoint.rl10.members.get('eng-s')?.access === 'private', 'the record without the share');
    expect(await statusOf(b, 'app-s')).toBe('grade');
    expect(await waitFor(b, (m) => m.sub === 'sb' && m.t === 'ended', 'the held subscription’s end')).toMatchObject({ reason: 'removed' });
    expect(f.host.runs).toEqual([]);
  });

  it('takes a decision again when a record arrives during it', async () => {
    const f = await startEndpoint(org, started, withSminosRecords());
    const s = spawned(f, 'app-s', org.B, { recorded: 'eng-s', live: 'eng-s' });
    f.host.request('app-s', 'question', 'rq-1');
    f.host.request('app-s', 'question', 'rq-2');
    const sm = await sminos(f);
    const b = await openRemote(f, org.b1, org.B);
    const answer = (requestId: string) =>
      b.device.action({ machine: f.ref, action: 'session.answer', session: 'app-s', context: { lane: 'B', launchId: s.launchId, engineSessionId: 'eng-s' }, args: { appSessionId: 'app-s', requestId, answer: { kind: 'question', answers: { 'Which way?': 'left' } } } });
    expect(await act(b, answer('rq-1'))).toBe('ok'); // the bridge's decision, nothing arriving

    // the decision reads the pending request (the answer's grade) after the record: a record taking the session from
    // its spawner arrives meanwhile, and the decision taken again stands on it
    const pendingReads = () => f.host.calls.filter((c) => c.name === 'session.pendingRequest').length;
    const before = pendingReads();
    f.host.hold('session.pendingRequest');
    const acked = act(b, answer('rq-2'));
    await until(() => pendingReads() > before, 'the decision reading the pending request');
    sm.send({ t: 'member', ...laneBMember('eng-s', [org.C], { access: 'private' }) });
    await until(() => f.endpoint.rl10.members.get('eng-s') !== null, 'the record');
    f.host.release('session.pendingRequest');
    expect(await acked).toBe('grade');
    expect(pendingReads()).toBe(before + 1); // the second decision stopped at the record, before the pending request

    // a record that came and went during the decision leaves no record, but the hand-off: the bridge's own standing
    // moved, so the decision is taken again, and with nothing to bridge it is `grade`
    const t = spawned(f, 'app-t', org.B, { recorded: 'eng-t', live: 'eng-t' });
    f.host.request('app-t', 'question', 'rq-3');
    const again = pendingReads();
    f.host.hold('session.pendingRequest');
    const gone = act(b, b.device.action({ machine: f.ref, action: 'session.answer', session: 'app-t', context: { lane: 'B', launchId: t.launchId, engineSessionId: 'eng-t' }, args: { appSessionId: 'app-t', requestId: 'rq-3', answer: { kind: 'question', answers: { 'Which way?': 'left' } } } }));
    await until(() => pendingReads() > again, 'the decision reading the pending request');
    sm.send({ t: 'member', ...laneBMember('eng-t', [org.B]) });
    sm.send({ t: 'member', session: 'eng-t', gone: true });
    await until(() => handedOff(f).includes('app-t') && f.endpoint.rl10.members.get('eng-t') === null, 'the record come and gone');
    f.host.release('session.pendingRequest');
    expect(await gone).toBe('grade');
  });

  // the review's finding: before M11 a first record could only grant; under the bridge it can take, and its join awaits
  // the engine host, so the held subscription is held at the record, by its engine session, not after the join
  it('holds a subscription the bridge granted as soon as a first record grants its spawner nothing, before its join answers', async () => {
    const f = await startEndpoint(org, started, withSminosRecords());
    spawned(f, 'app-s', org.B, { recorded: 'eng-s', live: 'eng-s' });
    f.host.attach(true);
    const b = await openRemote(f, org.b1, org.B);
    expect(await subscribe(b, 'sb', { lane: 'B', id: 'app-s' })).toMatchObject({ t: 'subbed' });
    const sm = await sminos(f);
    f.host.hold('engine.sessions');
    const from = b.inbox.length;
    sm.send({ t: 'member', ...laneBMember('eng-s', [org.C], { access: 'private' }) });
    await until(() => f.endpoint.rl10.members.get('eng-s') !== null, 'the record');
    f.host.row('app-s', 1);
    expect(await waitFor(b, (m) => m.sub === 'sb' && m.t === 'ended', 'the held subscription’s end', from)).toMatchObject({ reason: 'removed' });
    expect(evs(b, 'sb', from)).toEqual([]);
    f.host.release('engine.sessions');
  });

  // the review's finding: a mark that can't be written yet withholds the record, so nothing is decided on a sight a restart
  // would forget; the session stays closed to everyone (no bridge) until a write holds
  it('withholds a record whose hand-off can’t be written yet, the session closed to everyone, until a write holds', async () => {
    let failing = true;
    const written: Marks[] = [];
    const members = new Members({
      dispatch: async (_owner, name) =>
        name === 'engine.sessions' ? { t: 'res', id: '0', ok: true, value: [{ appSessionId: 'app-w', engineSessionId: 'eng-w' }] } : { t: 'res', id: '0', ok: false, error: { code: 'unknown_command', message: name } },
      listings: { report: async () => {}, gone: async () => {} },
      listed: () => [],
      forget: () => {},
      log: () => {},
      now: Date.now,
      marks: {
        read: () => ({ appSessionIds: [], engineSessionIds: [] }),
        write: (marks) => {
          if (failing) throw new Error('ENOSPC');
          written.push(marks);
        },
      },
    });
    await members.member(laneBMember('eng-w', [org.C], { access: 'private' }));
    const target: SessionTarget = { lane: 'B', session: 'eng-w', appSessionId: 'app-w' };
    expect(members.record(target)).toBeNull();
    expect(members.handedOff(target)).toBe(true);
    expect(written).toEqual([]);
    failing = false;
    expect(members.record(target)).toMatchObject({ session: 'eng-w', owners: [org.C], access: 'private' });
    expect(written).toEqual([{ appSessionIds: ['app-w'], engineSessionIds: [] }]);
  });

  it('holds while the spine’s record has no engine session yet, placed on the engine host’s live one', async () => {
    const f = await startEndpoint(org, started, withSminosRecords());
    spawned(f, 'app-n', org.B, { recorded: null, live: 'eng-live' });
    const b = await openRemote(f, org.b1, org.B);
    expect(await call(b, 'session.status', { appSessionId: 'app-n' })).toMatchObject({ ok: true, output: { engineSessionId: 'eng-live' } });
    expect(await subscribe(b, 'sb', { lane: 'B', id: 'app-n' })).toMatchObject({ t: 'subbed' });
    const a = await openRemote(f, org.a1, org.A);
    expect(await statusOf(a, 'app-n')).toBe('grade');
  });

  it('is still `unavailable` to its spawner while the index lags the live engine session, and `grade` to everyone else', async () => {
    const f = await startEndpoint(org, started, withSminosRecords());
    spawned(f, 'app-l', org.B, { recorded: 'eng-old', live: 'eng-new' });
    const b = await openRemote(f, org.b1, org.B);
    expect(await statusOf(b, 'app-l')).toBe('unavailable');
    expect(await subscribe(b, 'sb', { lane: 'B', id: 'app-l' })).toMatchObject({ t: 'ended', reason: 'unavailable' });
    const a = await openRemote(f, org.a1, org.A);
    expect(await statusOf(a, 'app-l')).toBe('grade');
  });

  it('bridges nothing for a session whose spine record names no spawner', async () => {
    const f = await startEndpoint(org, started, withSminosRecords());
    f.host.add('app-x', 'eng-x');
    f.spine.set('app-x', 'eng-x');
    const b = await openRemote(f, org.b1, org.B);
    expect(await statusOf(b, 'app-x')).toBe('grade');
    const a = await openRemote(f, org.a1, org.A);
    expect(await statusOf(a, 'app-x')).toBe('grade');
  });

  describe('never again once a record was seen, the next member frame withheld', () => {
    it('after sminos withdraws the record (`gone`)', async () => {
      const f = await startEndpoint(org, started, withSminosRecords());
      spawned(f, 'app-g', org.B, { recorded: 'eng-g', live: 'eng-g' });
      const sm = await sminos(f, [laneAMember(), laneBMember('eng-g', [org.B])]);
      const b = await openRemote(f, org.b1, org.B);
      expect(await statusOf(b, 'app-g')).toBe('ok');
      sm.send({ t: 'member', session: 'eng-g', gone: true });
      await until(() => f.endpoint.rl10.members.get('eng-g') === null, 'the record withdrawn');
      expect(await statusOf(b, 'app-g')).toBe('grade');
      expect(await subscribe(b, 'sb', { lane: 'B', id: 'app-g' })).toMatchObject({ t: 'ended', reason: 'grade' });
    });

    it('after a `/clear`, until the new engine session’s record arrives', async () => {
      const f = await startEndpoint(org, started, withSminosRecords());
      const s = spawned(f, 'app-c', org.B, { recorded: 'eng-1', live: 'eng-1' });
      const sm = await sminos(f, [laneAMember(), laneBMember('eng-1', [org.B])]);
      const b = await openRemote(f, org.b1, org.B);
      expect(await statusOf(b, 'app-c')).toBe('ok');
      // the conversation goes on as eng-2, the engine host and the index both saying so; sminos's record of it lags
      s.engineSessionId = 'eng-2';
      f.spine.set('app-c', 'eng-2', { launchedBy: launchedBy(org.B) });
      expect(await statusOf(b, 'app-c')).toBe('grade');
      const a = await openRemote(f, org.a1, org.A);
      expect(await statusOf(a, 'app-c')).toBe('grade');
      // its record arrives, its predecessor's owners carried by sminos: it decides
      sm.send({ t: 'member', ...laneBMember('eng-2', [org.B]) });
      await until(() => f.endpoint.rl10.members.get('eng-2') !== null, 'the new engine session’s record');
      expect(await statusOf(b, 'app-c')).toBe('ok');
    });

    it('after an endpoint restart, before sminos restates', async () => {
      const f = await startEndpoint(org, started, withSminosRecords());
      spawned(f, 'app-r', org.B, { recorded: 'eng-r', live: 'eng-r' });
      await sminos(f, [laneAMember(), laneBMember('eng-r', [org.B])]);
      await until(() => handedOff(f).includes('app-r'), 'the hand-off on disk');
      f.sminos?.close();
      await f.endpoint.stop();
      started.splice(started.indexOf(f), 1);
      const g = await startEndpoint(org, started, withSminosRecords(f));
      expect(g.endpoint.rl10.members.get('eng-r')).toBeNull();
      const b = await openRemote(g, org.b1, org.B);
      expect(await statusOf(b, 'app-r')).toBe('grade');
      // a session spawned since, never handed off, is bridged as before
      spawned(g, 'app-new', org.B, { recorded: 'eng-new', live: 'eng-new' });
      expect(await statusOf(b, 'app-new')).toBe('ok');
    });

    // the review's finding: a record the join could not place under its app session (the engine host away) is marked by
    // its engine session, which the placement after the restart lands on
    it('after an endpoint restart, for a record the engine host could not place under its app session', async () => {
      const f = await startEndpoint(org, started, withSminosRecords());
      spawned(f, 'app-u', org.B, { recorded: 'eng-u', live: 'eng-u' });
      f.host.fail('engine.sessions');
      await sminos(f, [laneAMember(), laneBMember('eng-u', [org.C], { access: 'private' })]);
      await until(() => marksOf(f).engineSessionIds.includes('eng-u'), 'the engine session marked');
      expect(handedOff(f)).not.toContain('app-u');
      f.sminos?.close();
      await f.endpoint.stop();
      started.splice(started.indexOf(f), 1);
      f.host.heal('engine.sessions');
      const g = await startEndpoint(org, started, withSminosRecords(f));
      const b = await openRemote(g, org.b1, org.B);
      expect(await statusOf(b, 'app-u')).toBe('grade');
      // placed on that engine session, the mark passed to its app session, so a `/clear` after it is covered too
      expect(marksOf(g)).toEqual({ version: 1, appSessionIds: ['app-u'], engineSessionIds: [] });
      const s = g.host.session('app-u');
      s.engineSessionId = 'eng-u2';
      g.spine.set('app-u', 'eng-u2', { launchedBy: launchedBy(org.B) });
      expect(await statusOf(b, 'app-u')).toBe('grade');
    });

    // the review's round 2: the sight is on disk before the join awaits the engine host, so a restart while the join is
    // outstanding loses nothing
    it('after an endpoint restart while the first record’s join is still outstanding', async () => {
      const f = await startEndpoint(org, started, withSminosRecords());
      spawned(f, 'app-h', org.B, { recorded: 'eng-h', live: 'eng-h' });
      f.host.hold('engine.sessions');
      await sminos(f, [laneAMember(), laneBMember('eng-h', [org.C], { access: 'private' })]);
      await until(() => marksOf(f).engineSessionIds.includes('eng-h'), 'the engine session marked before its join');
      f.sminos?.close();
      await f.endpoint.stop();
      started.splice(started.indexOf(f), 1);
      const g = await startEndpoint(org, started, withSminosRecords(f));
      const b = await openRemote(g, org.b1, org.B);
      expect(await statusOf(b, 'app-h')).toBe('grade');
      f.host.release('engine.sessions');
    });
  });

  it('prunes the mark of the app sessions the spine no longer holds, when first read', async () => {
    const services = fakeServices();
    EndpointState.open(services.machine.stateDir).setHandedOff({ appSessionIds: ['app-deleted', 'app-kept'], engineSessionIds: [] });
    const f = await startEndpoint(org, started, { ...withSminosRecords(), services });
    spawned(f, 'app-kept', org.B, { recorded: 'eng-k', live: 'eng-k' });
    const b = await openRemote(f, org.b1, org.B);
    expect(await statusOf(b, 'app-kept')).toBe('grade'); // handed off before this start: no bridge
    await until(() => !handedOff(f).includes('app-deleted'), 'the deleted app session pruned');
    expect(handedOff(f)).toEqual(['app-kept']);
  });
});
