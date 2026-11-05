// The endpoint's policy cache (P5 O18 D7, docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md M2): remote
// sessions' audiences from verified snapshots, kept across restarts, rebuilt from sminos's log through paged
// `snapshots?` when the file is lost, and what waits on it meanwhile.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, signEvent, streamWriter, type Certificates, type OrgState, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { EndpointPolicy } from '../../../src/endpoint/policy';
import { Rl10 } from '../../../src/endpoint/rl10/link';
import { PolicyCache } from '../../../src/endpoint/rl10/policy-cache';
import { EndpointState } from '../../../src/endpoint/state/store';
import { genesis, memberId, newDevice, successor } from '../org-fixtures';
import { FakeSminos, type Frame } from './fake-sminos';

const ORG = 'org-cache';
const REF = 'q4Hc2Wv9Kp0Lm8Tr1Xy7Za';
const MINI = 'm1Hc2Wv9Kp0Lm8Tr1Xy7Zb';
const OTHER = 'o3Hc2Wv9Kp0Lm8Tr1Xy7Zd';
const NO_CERTS: Certificates = { certs: [], retirements: [] };
const P1 = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c41';
const P2 = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c42';
const P3 = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c43';
const LOCAL = '11111111-1111-4111-8111-111111111111';

const dirs: string[] = [];
const scratch = () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rl10-cache-'));
  fs.chmodSync(dir, 0o700);
  dirs.push(dir);
  return dir;
};
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

let clock = Date.UTC(2026, 10, 5, 12);
const at = () => new Date(++clock).toISOString();
const sid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const sorted = (m: string[]) => [...new Set(m)].sort();

describe('the cache itself', () => {
  const snap = (session: string, machine: string, policyRev: number, audience: string[] | null, created = at()) => ({ session, machine, audience, policyRev, created, owners: ['o'] });

  it('settles on the highest policyRev whatever the order, a tie on the later created, and a plain snapshot of a higher rev clears it', () => {
    const cache = new PolicyCache(null, () => {});
    const early = at();
    const late = at();
    expect(cache.take(snap('s', MINI, 3, ['a', 'b'], early))).toBe(true);
    expect(cache.take(snap('s', MINI, 2, ['a']))).toBe(false);
    expect(cache.get('s')?.audience).toEqual(['a', 'b']);
    expect(cache.take(snap('s', MINI, 3, ['a'], late))).toBe(true);
    expect(cache.take(snap('s', MINI, 3, ['b'], early))).toBe(false);
    expect(cache.get('s')?.audience).toEqual(['a']);
    expect(cache.take(snap('s', MINI, 4, null))).toBe(true);
    expect(cache.get('s')).toMatchObject({ audience: null, policyRev: 4 });
  });

  it('keeps a session bound to its machine; a rebuild that finds two leaves it unbound for good', () => {
    const cache = new PolicyCache(null, () => {});
    cache.take(snap('s', MINI, 1, ['a']));
    expect(cache.take(snap('s', OTHER, 9, null))).toBe(false);
    expect(cache.get('s')?.machine).toBe(MINI);
    expect(cache.take(snap('s', OTHER, 9, null), true)).toBe(true);
    expect(cache.get('s')).toBeNull();
    expect(cache.confirmed('s')).toBe(false);
    expect(cache.take(snap('s', MINI, 10, ['a']))).toBe(false);
  });

  it('keeps a quiet session’s entry, its projects done and the local history across a restart', () => {
    const dir = scratch();
    const first = new PolicyCache(() => dir, () => {});
    first.take(snap('quiet', MINI, 7, ['a']));
    first.markDone(P1);
    first.remember(LOCAL, 1, ['a', 'b']);
    first.remember(LOCAL, 2, ['a']);
    const again = new PolicyCache(() => dir, () => {});
    expect(again.get('quiet')).toMatchObject({ machine: MINI, policyRev: 7, audience: ['a'] });
    expect(again.done(P1)).toBe(true);
    expect(again.before(LOCAL, 2)).toEqual({ policyRev: 1, audience: ['a', 'b'] });
    expect((fs.statSync(join(dir, 'cache.json')).mode & 0o777).toString(8)).toBe('600');
  });

  it('reads an unreadable file as empty: nothing known and no project done, so everything is read back', () => {
    const dir = scratch();
    fs.writeFileSync(join(dir, 'cache.json'), '{"v": 1, "done": [', { mode: 0o600 });
    const lines: string[] = [];
    const cache = new PolicyCache(() => dir, (l) => void lines.push(l));
    expect(cache.done(P1)).toBe(false);
    expect(cache.policies()).toEqual([]);
    expect(lines.join('\n')).toContain('rebuilt from the log');
  });
});

/** The org (admin A, C; `host` A's, `mini` C's), a served RL10 on `dir`, and a scripted sminos that opens `projects`. */
async function served(dir: string) {
  const a1 = await newDevice('a1');
  const host = await generateSigningKey();
  const mini = await generateSigningKey();
  const other = await generateSigningKey();
  const A = memberId();
  const C = memberId();
  let head: SignedOrgState = await genesis(ORG, A, a1, await generateSigningKey());
  head = await successor(head, [a1], (s) => {
    s.members.push({ id: C, email: 'c@example.com', role: 'member', devices: [] });
    s.machines.push({ name: 'host', ref: REF, pub: host.pub, owners: [A] }, { name: 'mini', ref: MINI, pub: mini.pub, owners: [C] }, { name: 'other', ref: OTHER, pub: other.pub, owners: [C] });
    s.machineNames.push({ name: 'host', ref: REF }, { name: 'mini', ref: MINI }, { name: 'other', ref: OTHER });
  });
  return { a1, host, mini, other, A, C, head, dir };
}

type Org = Awaited<ReturnType<typeof served>>;

async function start(o: Org) {
  const state = EndpointState.open(o.dir);
  const toHub: Frame[] = [];
  const rl10 = new Rl10({
    stateDir: () => o.dir,
    build: 'cache',
    state: () => state,
    head: () => ({ state: o.head.state as OrgState, certificates: NO_CERTS }),
    identity: () => ({ org: ORG, hub: 'http://127.0.0.1:1', name: 'host', ref: REF, enrolled: '2026-10-27T18:00:00.000Z' }),
    key: () => ({ key: o.host, keyId: 'k' }),
    policy: new EndpointPolicy(() => state),
    hub: { openProject: () => () => {}, send: (f) => (toHub.push(structuredClone(f) as Frame), true), capabilities: ['audience'] },
    listings: { report: async () => {}, gone: async () => {}, refresh: async () => {}, listedSessions: () => [] },
    notifier: { pendingSet: () => {}, requestMessage: () => {}, hostMessage: () => {}, forget: () => {} },
    machineOwners: async () => [o.A],
    dispatch: () => Promise.reject(new Error('none')),
    now: Date.now,
    log: () => {},
  });
  await rl10.serve();
  closers.push(() => rl10.unserve());
  const info = JSON.parse(fs.readFileSync(join(o.dir, 'rl10.json'), 'utf8')) as { socket: string; token: string };
  const connect = async () => {
    const sminos = await FakeSminos.open(info.socket);
    closers.push(() => sminos.close());
    sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: ['audience'], token: info.token, sminos: { version: 'cache' }, policy: { read_only: false, ceiling: 'settings' } });
    await sminos.next((f) => f.t === 'welcome', 'the welcome');
    return sminos;
  };
  return { rl10, toHub, connect };
}

/** A snapshot of `session` signed by `key` as `name`, plain or in the stream of `audience`. */
async function snapshot(project: string, key: SigningKey, name: string, session: string, policyRev: number, audience: string[] | null, seq = 1) {
  const created = at();
  const base = `${name}/${session}`;
  const writer = audience === null ? base : streamWriter(base, audience);
  const body = { ts: created, created, writer, seq, kind: 'joined', session, alias: 'x', policyRev, ...(audience === null ? {} : { audience }) };
  return { ...(await signEvent({ org: ORG, project }, body, key.privateKey, key.pub)), verified: { signer: { kind: 'machine' } } };
}

describe('the rebuild', () => {
  it('reads back every page of every project, re-verifying each snapshot, and marks each project done', async () => {
    const o = await served(scratch());
    const { rl10, connect } = await start(o);
    const sminos = await connect();
    const pages: Record<string, unknown[][]> = {
      [P1]: [[await snapshot(P1, o.mini, 'mini', sid(1), 2, sorted([o.A, o.C]))], [await snapshot(P1, o.mini, 'mini', sid(2), 1, null)]],
      [P2]: [[await snapshot(P2, o.mini, 'mini', sid(3), 4, [o.C]), { ...(await snapshot(P2, o.mini, 'mini', sid(4), 1, null)), alias: 'tampered' }], [], [await snapshot(P2, o.mini, 'mini', sid(5), 3, [o.C])]],
    };
    sminos.send({ t: 'hello', project: P1, name: 'host', have: {} });
    sminos.send({ t: 'hello', project: P2, name: 'host', have: {} });
    for (const project of [P1, P2]) {
      for (let page = 0; page < pages[project].length; page++) {
        const ask = await sminos.next((f) => f.t === 'snapshots?' && f.project === project, `${project} page ${page}`);
        expect(ask.after).toBe(page === 0 ? undefined : `c${page}`);
        const last = page === pages[project].length - 1;
        sminos.send({ t: 'snapshots', id: ask.id, project, events: pages[project][page], next: last ? null : `c${page + 1}`, done: last });
      }
    }
    await sminos.next((f) => f.t === 'audience' && f.session === sid(5), 'the last session’s audience');
    expect(rl10.cache.done(P1) && rl10.cache.done(P2)).toBe(true);
    expect(rl10.cache.get(sid(1))).toMatchObject({ machine: MINI, audience: sorted([o.A, o.C]), policyRev: 2 });
    expect(rl10.cache.get(sid(3))?.audience).toEqual([o.C]);
    expect(rl10.cache.get(sid(5))?.audience).toEqual([o.C]);
    // What doesn't verify isn't taken.
    expect(rl10.cache.get(sid(4))).toBeNull();
    // Each known session goes to sminos as an `audience` frame.
    expect(sminos.received.find((f) => f.t === 'audience' && f.session === sid(1))).toMatchObject({ members: sorted([o.A, o.C]), policyRev: 2 });
    // Done is done: a new connection asks nothing.
    const again = await connect();
    again.send({ t: 'hello', project: P1, name: 'host', have: {} });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(again.received.some((f) => f.t === 'snapshots?')).toBe(false);
    expect(again.received.some((f) => f.t === 'audience' && f.session === sid(1))).toBe(true);
  });

  it('keeps each session’s machine, and leaves one whose snapshots name two machines unbound', async () => {
    const o = await served(scratch());
    const { rl10, connect } = await start(o);
    const sminos = await connect();
    sminos.send({ t: 'hello', project: P1, name: 'host', have: {} });
    const ask = await sminos.next((f) => f.t === 'snapshots?', 'the ask');
    sminos.send({
      t: 'snapshots',
      id: ask.id,
      project: P1,
      events: [await snapshot(P1, o.mini, 'mini', sid(1), 1, [o.C]), await snapshot(P1, o.mini, 'mini', sid(2), 1, null), await snapshot(P1, o.other, 'other', sid(2), 2, [o.C])],
      next: null,
      done: true,
    });
    for (let i = 0; i < 100 && !rl10.cache.done(P1); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rl10.cache.get(sid(1))?.machine).toBe(MINI);
    expect(rl10.cache.get(sid(2))).toBeNull();
  });

  it('resumes a dropped rebuild from the first project not done, and holds an upload naming an unconfirmed session until it completes', async () => {
    const o = await served(scratch());
    const { rl10, toHub, connect } = await start(o);
    let sminos = await connect();
    sminos.send({ t: 'member', session: LOCAL, alias: 'me', project: P1, lane: 'A', state: 'idle', cwd: '/w', owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' } });
    for (const project of [P1, P2, P3]) sminos.send({ t: 'hello', project, name: 'host', have: {} });
    let ask = await sminos.next((f) => f.t === 'snapshots?' && f.project === P1, 'P1');
    sminos.send({ t: 'snapshots', id: ask.id, project: P1, events: [], next: null, done: true });
    ask = await sminos.next((f) => f.t === 'snapshots?' && f.project === P2, 'P2');
    sminos.send({ t: 'snapshots', id: ask.id, project: P2, events: [await snapshot(P2, o.mini, 'mini', sid(7), 1, [o.C])], next: 'c1', done: false });
    await sminos.next((f) => f.t === 'snapshots?' && f.project === P2 && f.after === 'c1', 'P2’s second page');
    // An upload naming a session not confirmed yet: neither signed nor refused.
    const say = { ts: at(), writer: `host/${LOCAL}`, seq: 1, kind: 'say', from: 'me', to: [{ session: sid(9), alias: 'far' }], text: 'hi' };
    sminos.send({ t: 'events', project: P1, events: [say] });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(toHub.some((f) => f.t === 'events')).toBe(false);
    expect(sminos.received.some((f) => f.t === 'refused')).toBe(false);
    expect(rl10.relay.heldAt(P1, `host/${LOCAL}`)).toBe(1);
    // The link drops mid-project; the next connection starts again from P2, the first not done.
    sminos.close();
    sminos = await connect();
    for (const project of [P1, P2, P3]) sminos.send({ t: 'hello', project, name: 'host', have: {} });
    ask = await sminos.next((f) => f.t === 'snapshots?', 'the resumed ask');
    expect(ask).toMatchObject({ project: P2 });
    expect(ask.after).toBeUndefined();
    sminos.send({ t: 'snapshots', id: ask.id, project: P2, events: [], next: null, done: true });
    ask = await sminos.next((f) => f.t === 'snapshots?' && f.project === P3, 'P3');
    // The upload comes again (the new connection's sminos uploads it again), still held until P3 is done.
    sminos.send({ t: 'events', project: P1, events: [say] });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(toHub.some((f) => f.t === 'events')).toBe(false);
    sminos.send({ t: 'snapshots', id: ask.id, project: P3, events: [], next: null, done: true });
    // Complete: asked for again, and signed with no audience, the hub the backstop.
    const resend = await sminos.next((f) => f.t === 'resend' && f.writer === `host/${LOCAL}`, 'the ask for the held upload');
    expect(resend.from).toBe(1);
    sminos.send({ t: 'events', project: P1, events: [say] });
    for (let i = 0; i < 100 && !toHub.some((f) => f.t === 'events'); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    const up = toHub.find((f) => f.t === 'events')?.events as Array<Record<string, unknown>>;
    expect(up[0]).toMatchObject({ writer: `host/${LOCAL}`, seq: 1 });
    expect(up[0].audience).toBeUndefined();
  });

  it('asks nothing of an sminos whose hello lacks `audience`, and holds nothing for it', async () => {
    const o = await served(scratch());
    await start(o);
    const state = JSON.parse(fs.readFileSync(join(o.dir, 'rl10.json'), 'utf8')) as { socket: string; token: string };
    const old = await FakeSminos.open(state.socket);
    closers.push(() => old.close());
    old.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: state.token, sminos: { version: 'old' }, policy: { read_only: false, ceiling: 'settings' } });
    await old.next((f) => f.t === 'welcome', 'the welcome');
    old.send({ t: 'hello', project: P1, name: 'host', have: {} });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(old.received.some((f) => f.t === 'snapshots?' || f.t === 'audience')).toBe(false);
  });
});
