// The `artifact` target rule (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "The `artifact`
// target rule"; the owner's A12). An artifact names no session: the rule reads it from the input, its links from the
// engine host's store (`library.entry`), each linked session placed as lane B places one, and ranks the member by the
// highest rank they hold on a linked session; one of the machine's owners holds `manage` on every artifact, read before
// any link is placed; an artifact with no link is the owners' alone; an unknown one is `grade`. `copyAsset` is ranked on
// `to` and reads `from` by effect. An act's claim names the artifact, so a query re-places it, across an endpoint restart.
// The placements are kept per channel and dropped by a record change, a relink, a `caps` refresh and a new head; the
// standing is read through the decision's records, so a record arriving mid-decision takes it again, and the spawner of a
// session sminos has not yet listed holds its artifacts as it holds the session (P5 O12 M11's bridge).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gradeOf } from '@shared/ipc/grades';
import type { Action } from 'org-protocol';
import type { RecordSource, SessionRecord, SessionTarget } from '../../src/endpoint/sources';
import { act, CHECKOUT, done, laneAMember, makeOrg, openRemote, PROJECT, Records, sminos, startEndpoint, stopAll, until, waitFor, type Fixture, type HostSession, type Msg, type Org, type Remote, type StartOptions } from './sub-harness';

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
const codeOf = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);
const get = async (r: Remote, artifactId: string) => codeOf(await call(r, 'artifacts.get', { artifactId }));
/** An artifact act (no session, no context: the third act shape). */
const actOf = (f: Fixture, r: Remote, action: string, args: Record<string, unknown>): Action => r.device.action({ machine: f.ref, action, args });
const update = (f: Fixture, r: Remote, artifactId: string, title = 'renamed') => actOf(f, r, 'artifacts.update', { artifactId, title });
/** An act's word, and its outcome once accepted. */
async function run(r: Remote, action: Action): Promise<{ ack: string; outcome?: unknown }> {
  const from = r.inbox.length;
  const ack = await act(r, action);
  return ack === 'ok' ? { ack, outcome: await done(r, action, from) } : { ack };
}
/** How many times the store was asked for an artifact's links. */
const entries = (f: Fixture) => f.host.calls.filter((c) => c.name === 'library.entry').length;

/**
 * A lane B session: its engine host row, its spine record and its member record (`owners`, `fields`: access and shares).
 * The machine's owners (A) own `@machine`'s; B is a member.
 */
function session(f: Fixture, app: string, owners: string[], fields: Partial<SessionRecord> = {}): HostSession {
  const s = f.host.add(app);
  f.spine.set(app, s.engineSessionId);
  f.records.set({ lane: 'B', session: s.engineSessionId!, owners, access: 'private', ...fields }, app);
  return s;
}
const shared = (member: string): Partial<SessionRecord> => ({ shares: [{ member, grade: 'view' }] });

describe('the artifact rule', () => {
  it('gives a machine owner `manage` on an artifact with no link and on one linked to a session they don’t own, without reading the store', async () => {
    const f = await startEndpoint(org, started);
    session(f, 'app-b', [org.B]);
    const orphan = randomUUID();
    const bs = randomUUID();
    f.host.artifact(orphan);
    f.host.artifact(bs, ['app-b']);
    const a = await openRemote(f, org.a1, org.A);
    for (const id of [orphan, bs]) {
      expect(await get(a, id)).toBe('ok');
      expect(await run(a, update(f, a, id))).toMatchObject({ ack: 'ok', outcome: { state: 'done' } });
    }
    expect(f.host.artifactRuns.map((r) => (r.input as { artifactId: string }).artifactId)).toEqual([orphan, bs]);
    expect(entries(f)).toBe(0); // the owners' short cut is read before any link
  });

  it('admits a member who views one of two linked sessions at `view`, and refuses them `manage`', async () => {
    const f = await startEndpoint(org, started);
    session(f, 'app-1', ['@machine'], shared(org.B));
    session(f, 'app-2', ['@machine']);
    const x = randomUUID();
    f.host.artifact(x, ['app-1', 'app-2']);
    const b = await openRemote(f, org.b1, org.B);
    expect(await get(b, x)).toBe('ok');
    expect(await run(b, update(f, b, x))).toEqual({ ack: 'grade' });
    expect(f.host.artifactRuns).toEqual([]);
  });

  it('refuses `grade` to a member with no rank on any linked session, on an orphan, on an unknown artifact, and their create', async () => {
    const f = await startEndpoint(org, started);
    session(f, 'app-2', ['@machine']);
    const x = randomUUID();
    const orphan = randomUUID();
    f.host.artifact(x, ['app-2']);
    f.host.artifact(orphan);
    const a = await openRemote(f, org.a1, org.A);
    const b = await openRemote(f, org.b1, org.B);
    expect(await get(b, x)).toBe('grade');
    expect(await get(b, orphan)).toBe('grade');
    expect(await get(b, randomUUID())).toBe('grade');
    const create = (r: Remote) => actOf(f, r, 'artifacts.create', { kind: 'document', title: 'mine' });
    f.host.handlers.set('artifacts.create', () => ({ artifact: f.host.artifact(randomUUID()) }));
    expect(await run(b, create(b))).toEqual({ ack: 'grade' });
    expect(await run(a, create(a))).toMatchObject({ ack: 'ok', outcome: { state: 'done' } });
    expect(f.host.artifactRuns.map((r) => r.name)).toEqual(['artifacts.create']);
  });

  it('ranks `copyAsset` on `to` (manage) and reads `from` by effect (view), under its production declaration', async () => {
    expect(gradeOf('artifacts.copyAsset')).toEqual({ floor: 'manage', byEffect: true });
    const f = await startEndpoint(org, started);
    session(f, 'app-1', ['@machine'], shared(org.B)); // B views
    session(f, 'app-2', ['@machine']); // B holds nothing
    session(f, 'app-b', [org.B]); // B owns
    const [viewed, hidden, owned, onlyViewed] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    f.host.artifact(viewed, ['app-1']);
    f.host.artifact(hidden, ['app-2']);
    f.host.artifact(owned, ['app-b']);
    f.host.artifact(onlyViewed, ['app-1']);
    f.host.handlers.set('artifacts.copyAsset', () => ({ assetId: randomUUID(), ref: 'assets/copy.png' }));
    const b = await openRemote(f, org.b1, org.B);
    const copy = (from: string, to: string) => actOf(f, b, 'artifacts.copyAsset', { from, ref: 'assets/a.png', to });
    expect(await run(b, copy(hidden, owned))).toEqual({ ack: 'grade' }); // `view` lacking on `from`
    expect(await run(b, copy(viewed, onlyViewed))).toEqual({ ack: 'grade' }); // `manage` lacking on `to`
    expect(await run(b, copy(viewed, owned))).toMatchObject({ ack: 'ok', outcome: { state: 'done' } });
    expect(f.host.artifactRuns.map((r) => r.input)).toEqual([{ from: viewed, ref: 'assets/a.png', to: owned }]);
  });

  it('answers a query of an artifact act after the endpoint’s restart, re-placed from the claim’s target, and refuses it once the last share goes', async () => {
    let f = await startEndpoint(org, started);
    session(f, 'app-b', [org.B]);
    const s1 = session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-b', 'app-1']);
    let b = await openRemote(f, org.b1, org.B);
    const action = update(f, b, x);
    expect(await run(b, action)).toMatchObject({ ack: 'ok', outcome: { state: 'done' } });
    // The claim names the artifact, nothing of a channel.
    const claimed = f.host.calls.find((c) => c.name === 'host.artifactOp');
    expect(claimed?.input).toMatchObject({ target: `artifact:${x}`, name: 'artifacts.update' });
    expect(claimed?.input).not.toHaveProperty('context');

    f.sminos?.close();
    await f.endpoint.stop();
    started.splice(started.indexOf(f), 1);
    f = await startEndpoint(org, started, { services: f.services, host: f.host, records: f.records, chain: f.chain, key: f.key });
    b = await openRemote(f, org.b1, org.B);
    const query = async () => {
      const from = b.inbox.length;
      await b.channel.send({ t: 'query', opId: action.opId, opCreated: action.opCreated, executor: 'engine-host' });
      return waitFor(b, (m) => m.t === 'queried' && m.opId === action.opId, 'the query’s answer', from);
    };
    expect(await query()).toMatchObject({ state: 'done', outcome: { state: 'done' } });
    // B's ownership goes: the share on app-1 still lets B view the artifact, which a query needs.
    f.records.set({ lane: 'B', session: 'eng-app-b', owners: ['@machine'], access: 'private' }, 'app-b');
    expect(await query()).toMatchObject({ state: 'done' });
    // The last share goes.
    f.records.set({ lane: 'B', session: s1.engineSessionId!, owners: ['@machine'], access: 'private' }, 'app-1');
    expect(await query()).toMatchObject({ state: 'refused', reason: 'grade' });
  });
});

describe('the rule’s cache', () => {
  it('reads an artifact’s links once per channel, and again after a share is withdrawn, which then refuses the next request', async () => {
    const f = await startEndpoint(org, started);
    const s1 = session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-1']);
    const b = await openRemote(f, org.b1, org.B);
    expect(await get(b, x)).toBe('ok');
    expect(await get(b, x)).toBe('ok');
    expect(entries(f)).toBe(1);
    f.records.set({ lane: 'B', session: s1.engineSessionId!, owners: ['@machine'], access: 'private' }, 'app-1');
    expect(await get(b, x)).toBe('grade');
    expect(entries(f)).toBe(2); // the record change dropped the entry
  });

  it('places an artifact again at its relink (`artifacts.changed {linked}`)', async () => {
    const f = await startEndpoint(org, started);
    session(f, 'app-1', ['@machine'], shared(org.B));
    session(f, 'app-2', ['@machine']);
    const x = randomUUID();
    f.host.artifact(x, ['app-2']);
    const b = await openRemote(f, org.b1, org.B);
    expect(await get(b, x)).toBe('grade');
    f.host.link(x, 'app-1');
    expect(await get(b, x)).toBe('ok');
    f.host.unlink(x, ['app-2']);
    expect(await get(b, x)).toBe('grade');
    expect(entries(f)).toBe(3);
  });

  it('places an artifact again when a linked session’s record in the spine moves (a new engine session)', async () => {
    const f = await startEndpoint(org, started);
    session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-1']);
    // The member record of the engine session a `/clear` will start, which B holds nothing on, is there already.
    f.records.set({ lane: 'B', session: 'eng-app-1-cleared', owners: ['@machine'], access: 'private' }, 'app-1');
    const b = await openRemote(f, org.b1, org.B);
    expect(await get(b, x)).toBe('ok');
    // The `/clear`: the index names the new engine session, and says so; no member record moves.
    f.host.session('app-1').engineSessionId = 'eng-app-1-cleared';
    const record = f.spine.set('app-1', 'eng-app-1-cleared');
    f.host.emitMachine('session.changed', { record: { appId: 'app-1', ...record } });
    expect(await get(b, x)).toBe('grade');
  });

  it('answers `unavailable` when the store can’t say what an artifact is linked to', async () => {
    const f = await startEndpoint(org, started);
    session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-1']);
    const b = await openRemote(f, org.b1, org.B);
    f.host.fail('library.entry');
    expect(await get(b, x)).toBe('unavailable');
    f.host.heal('library.entry');
    expect(await get(b, x)).toBe('ok'); // an unplaceable answer is never kept
  });
});

/**
 * A record source that, once, moves a record right after a decision read it (as sminos's frame landing mid-decision), and
 * tells no listener: what re-decides is the decision's own check of the records it read, not the cache's drop.
 */
class Moving extends Records {
  next: SessionRecord | null = null;
  override record(target: SessionTarget): SessionRecord | null {
    const read = super.record(target);
    const next = this.next;
    if (next !== null && target.session === next.session) {
      this.next = null;
      this.map.set(next.session, next);
    }
    return read;
  }
}

describe('the rule’s standing, read through the decision', () => {
  it('takes a decision again when a linked session’s record moves while it is taken', async () => {
    const records = new Moving();
    const f = await startEndpoint(org, started, { records });
    const s1 = session(f, 'app-1', ['@machine'], shared(org.B));
    const x = randomUUID();
    f.host.artifact(x, ['app-1']);
    const b = await openRemote(f, org.b1, org.B);
    records.next = { lane: 'B', session: s1.engineSessionId!, owners: ['@machine'], access: 'private' };
    expect(await get(b, x)).toBe('grade');
  });

  it('gives a session’s spawner its artifacts while sminos lists no record of it, then only what the record grants, the placement read again', async () => {
    const f = await startEndpoint(org, started, withSminosRecords());
    f.host.add('app-s', 'eng-s');
    f.spine.set('app-s', 'eng-s', { launchedBy: { member: org.B, device: 'b1', opId: 'op-spawn-000000000001', action: null } });
    const x = randomUUID();
    f.host.artifact(x, ['app-s']);
    const b = await openRemote(f, org.b1, org.B);
    const a = await openRemote(f, org.a1, org.A);
    expect(await run(b, update(f, b, x))).toMatchObject({ ack: 'ok', outcome: { state: 'done' } });
    expect(await get(b, x)).toBe('ok');
    const read = entries(f);
    // sminos's record arrives: C owns the session, B holds a view share.
    await sminos(f, [laneAMember(), laneBMember('eng-s', [org.C], { shares: [{ member: org.B, grade: 'view' }] })]);
    await until(() => f.endpoint.rl10.members.get('eng-s') !== null, 'the record');
    expect(await get(b, x)).toBe('ok');
    expect(entries(f)).toBeGreaterThan(read); // the arrival dropped the entry
    expect(await run(b, update(f, b, x, 'again'))).toEqual({ ack: 'grade' });
    expect(await get(a, x)).toBe('ok'); // the machine's owner, as ever
  });
});

// ---- P5 O12 M11's records, as sminos reports them (targets.test.ts' pattern) --------------------------------------------

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
const withSminosRecords = (): StartOptions => ({ records: new SminosRecords() });
const laneBMember = (session: string, owners: string[], fields: Record<string, unknown> = {}) => ({
  session, alias: 'spawned', project: PROJECT, lane: 'B', state: 'idle', title: 'spawned', cwd: CHECKOUT, owners, ownersProof: [], origin: { kind: 'maws', requester: owners[0] }, ...fields,
});
