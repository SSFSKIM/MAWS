// The record acts and their policy read (P5 O8 M6b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b and
// Interfaces §Q, agreed with the desk track), through a real RL2 channel to a started, enrolled endpoint, and a fake sminos
// on its real RL10 socket playing the executors' side: each offer's grade, validation and step-up; a lane A and a lane B
// target placed; the `rpc` carrying the act as its proof; `not-offered` without sminos's `record`; `record.policy`'s
// answers; and the welcome's `record`, exactly when the build serves the record acts.
//
// The org (sub-harness.ts): A owns the machine (a1); B is a member (b1). `la-1` is a lane A session of `@machine`'s; `app-b`
// a lane B session (engine session `eng-b`) of A's.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { memoryOrgView, type Action } from 'org-protocol';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import { LocalDoor } from '../../src/endpoint/local-door';
import { OFFERS, RECORD_ACTS, type Offers } from '../../src/endpoint/offers';
import { stepUpRequired } from '../../src/endpoint/step-up';
import { newDevice, type TestDevice } from './org-fixtures';
import type { FakeSminos } from './rl10/fake-sminos';
import { act, done, laneAMember, makeOrg, openRemote, ORG, PROJECT, sleep, sminos, startEndpoint, stopAll, until, type Fixture, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(() => stopAll(started));
afterAll(() => stopAll(started));

/** `la-1` with its policy as sminos's member frame carries it to an access-capable endpoint (O18 M3). */
const laneA = (fields: Record<string, unknown> = {}) => laneAMember({ access: 'listed', shares: [], policyRev: 3, ...fields });
/** `app-b`'s lane B member (engine session `eng-b`), A's. */
const laneB = (fields: Record<string, unknown> = {}) => laneAMember({ session: 'eng-b', alias: 'b', lane: 'B', title: 'b', owners: [org.A], access: 'private', shares: [{ member: org.B, grade: 'list' }], policyRev: 7, ...fields });

/** The machine, its lane B session `app-b` known to the spine and the engine host (and so to the members join). */
async function machine(options: { offers?: Offers } = {}): Promise<Fixture> {
  const f = await startEndpoint(org, started, options);
  f.host.add('app-b', 'eng-b');
  f.spine.set('app-b', 'eng-b');
  f.records.set({ lane: 'B', session: 'eng-b', owners: [org.A], access: 'private', shares: [{ member: org.B, grade: 'list' }] }, 'app-b');
  return f;
}

/** The fake sminos, welcomed, its hello advertising `capabilities`, reporting `la-1` and `app-b`'s member. */
async function withSminos(f: Fixture, capabilities: string[] = ['audience', 'record'], members = [laneA(), laneB()]): Promise<FakeSminos> {
  const s = await sminos(f, members, capabilities);
  await until(() => f.endpoint.rl10.members.appSessionId('eng-b'), 'app-b joined');
  return s;
}

const record = (r: Remote, f: Fixture, name: string, args: Record<string, unknown>): Promise<Action> => r.device.stepUp(r.device.action({ machine: f.ref, action: name, args }));

/** An act through the record path: its admission query answered `not-received`, then its ack; the rpc sminos got. */
async function sent(r: Remote, s: FakeSminos, action: Action): Promise<{ ack: string; rpc: Record<string, unknown> }> {
  const acked = act(r, action);
  await s.next((x) => x.t === 'query' && x.opId === action.opId, `the admission query of ${action.action}`);
  s.send({ t: 'queried', opId: action.opId, state: 'not-received' });
  const ack = await acked;
  const rpc = (await s.next((x) => x.t === 'rpc' && (x.rpc as Record<string, unknown>).opId === action.opId, `the rpc of ${action.action}`)).rpc as Record<string, unknown>;
  return { ack, rpc };
}

/** A call's result. */
async function call(r: Remote, name: string, input: unknown): Promise<Record<string, unknown>> {
  const id = `c-${Math.random().toString(36).slice(2)}`;
  const from = r.inbox.length;
  await r.channel.send({ t: 'call', id, name, input });
  return until(() => r.inbox.slice(from).find((m) => m.t === 'result' && (m as { id?: string }).id === id) as Record<string, unknown> | undefined, `the result of ${name}`);
}

describe('the record offers', () => {
  it('are `manage` acts sminos runs, on the `record` rule, each needing a step-up and sminos’s `record`; their policy read a `list` call', () => {
    for (const name of RECORD_ACTS) {
      expect(OFFERS.commands[name]).toMatchObject({ kind: 'act', executor: 'sminos', target: 'record', grade: 'manage', sminos: 'record' });
      expect(stepUpRequired({ name, grade: 'manage', ownsSession: true, ownsMachine: true }), name).toBe(true);
    }
    expect(OFFERS.commands['record.policy']).toMatchObject({ kind: 'call', executor: 'endpoint', target: 'machine', grade: 'list' });
  });

  it('take exactly one target and exactly their change', () => {
    const accepts = (name: string, args: unknown) => OFFERS.commands[name].accepts!(args);
    expect(accepts('record.access', { session: 'la-1', access: 'private' })).toBe(true);
    expect(accepts('record.access', { appSessionId: 'app-b', access: 'org-converse' })).toBe(true);
    expect(accepts('record.access', { session: 'la-1', appSessionId: 'app-b', access: 'private' }), 'two targets').toBe(false);
    expect(accepts('record.access', { access: 'private' }), 'no target').toBe(false);
    expect(accepts('record.access', { session: '', access: 'private' }), 'an empty id').toBe(false);
    expect(accepts('record.access', { session: 'la-1', access: 'public' }), 'no such level').toBe(false);
    expect(accepts('record.access', { session: 'la-1', access: 'private', extra: 1 }), 'a field past the change').toBe(false);
    expect(accepts('record.shares', { session: 'la-1', member: org.B, grade: 'list' })).toBe(true);
    expect(accepts('record.shares', { session: 'la-1', member: org.B, grade: null }), 'a share removed').toBe(true);
    expect(accepts('record.shares', { session: 'la-1', member: org.B, grade: 'manage' }), 'no share at manage').toBe(false);
    expect(accepts('record.shares', { session: 'la-1', member: org.B }), 'no grade').toBe(false);
    expect(accepts('record.owners', { appSessionId: 'app-b', add: true, member: org.B })).toBe(true);
    expect(accepts('record.owners', { appSessionId: 'app-b', add: false, member: org.B }), 'only an add').toBe(false);
    expect(OFFERS.commands['record.policy'].accepts!(null)).toBe(true);
    expect(OFFERS.commands['record.policy'].accepts!({ session: 'la-1' })).toBe(true);
    expect(OFFERS.commands['record.policy'].accepts!({ session: 'la-1', all: true })).toBe(false);
  });
});

describe('a record act, through the endpoint', () => {
  it('on lane A goes to sminos as its rpc, `args.session` the act’s own, the act verbatim as its proof, no context; its outcome comes back', async () => {
    const f = await machine();
    const s = await withSminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const access = await record(a, f, 'record.access', { session: 'la-1', access: 'private' });
    const { ack, rpc } = await sent(a, s, access);
    expect(ack).toBe('ok');
    expect(rpc).toEqual({
      rpc: 'record.access',
      project: PROJECT,
      machine: 'mini',
      member: org.A,
      device: 'a1',
      created: access.created,
      nonce: access.nonce,
      opId: access.opId,
      opCreated: access.opCreated,
      args: { session: 'la-1', access: 'private' },
      fingerprint: expect.any(String),
      proof: access,
    });
    s.send({ t: 'rpc-result', project: PROJECT, opId: access.opId, nonce: access.nonce, outcome: { state: 'done', result: { changed: true, policyRev: 4 } } });
    expect(await done(a, access)).toEqual({ state: 'done', result: { changed: true, policyRev: 4 } });
  });

  it('on lane B goes on the member the join placed its appSessionId on, the proof keeping the appSessionId as signed', async () => {
    const f = await machine();
    const s = await withSminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const share = await record(a, f, 'record.shares', { appSessionId: 'app-b', member: org.B, grade: 'view' });
    const { ack, rpc } = await sent(a, s, share);
    expect(ack).toBe('ok');
    expect(rpc.rpc).toBe('record.shares');
    expect(rpc.args).toEqual({ session: 'eng-b', member: org.B, grade: 'view' });
    expect(rpc.proof).toEqual(share);
    expect(rpc).not.toHaveProperty('context');
    expect(rpc).not.toHaveProperty('requestDigest');
    s.send({ t: 'rpc-result', project: PROJECT, opId: share.opId, nonce: share.nonce, outcome: { state: 'done', result: { changed: false, policyRev: 7 } } });
    expect(await done(a, share)).toEqual({ state: 'done', result: { changed: false, policyRev: 7 } });
  });

  it('on a lane B session no member places is refused `no-session` to its owner, and nothing goes to sminos', async () => {
    const f = await machine();
    f.spine.set('app-c', 'eng-c'); // the spine's, and A's by its record; sminos has sent no member for it
    f.records.set({ lane: 'B', session: 'eng-c', owners: [org.A] }, 'app-c');
    const s = await withSminos(f);
    const a = await openRemote(f, org.a1, org.A);
    expect(await act(a, await record(a, f, 'record.access', { appSessionId: 'app-c', access: 'private' }))).toBe('no-session');
    await sleep(100);
    expect(s.received.filter((x) => x.t === 'query' || x.t === 'rpc')).toEqual([]);
  });

  it('by anyone but an owner is refused `grade`, before anything goes to sminos, a session they can’t see as one that isn’t', async () => {
    const f = await machine();
    const s = await withSminos(f);
    const b = await openRemote(f, org.b1, org.B);
    expect(await act(b, await record(b, f, 'record.access', { session: 'la-1', access: 'org-view' }))).toBe('grade');
    expect(await act(b, await record(b, f, 'record.shares', { appSessionId: 'app-b', member: org.B, grade: 'approve' }))).toBe('grade');
    expect(await act(b, await record(b, f, 'record.access', { appSessionId: 'app-none', access: 'private' }))).toBe('grade');
    await sleep(100);
    expect(s.received.filter((x) => x.t === 'query' || x.t === 'rpc')).toEqual([]);
  });

  it('with no step-up, a target and a session or context, or args past the change, is refused and goes nowhere', async () => {
    const f = await machine();
    const s = await withSminos(f);
    const a = await openRemote(f, org.a1, org.A);
    expect(await act(a, a.device.action({ machine: f.ref, action: 'record.access', args: { session: 'la-1', access: 'private' } }))).toBe('step-up');
    const withSession = await a.device.stepUp(a.device.action({ machine: f.ref, action: 'record.access', session: 'la-1', context: { lane: 'A', session: 'la-1', launch: 'L1' }, args: { session: 'la-1', access: 'private' } }));
    expect(await act(a, withSession)).toBe('malformed');
    expect(await act(a, await record(a, f, 'record.access', { session: 'la-1', access: 'private', note: 'x' }))).toBe('malformed');
    await sleep(100);
    expect(s.received.filter((x) => x.t === 'query' || x.t === 'rpc')).toEqual([]);
  });

  it('is `not-offered` while the machine’s sminos doesn’t advertise `record`, and `unavailable` with no sminos, nothing sent', async () => {
    const f = await machine();
    const a = await openRemote(f, org.a1, org.A);
    expect(await act(a, await record(a, f, 'record.access', { session: 'la-1', access: 'private' }))).toBe('unavailable');
    const s = await withSminos(f, ['audience']);
    for (const name of RECORD_ACTS) {
      const args = name === 'record.access' ? { access: 'private' } : name === 'record.shares' ? { member: org.B, grade: 'view' } : { add: true, member: org.B };
      expect(await act(a, await record(a, f, name, { session: 'la-1', ...args })), name).toBe('not-offered');
    }
    await sleep(100);
    expect(s.received.filter((x) => x.t === 'query' || x.t === 'rpc')).toEqual([]);
  });

  it('lost, is found by its query on either lane, as sminos binds it', async () => {
    const f = await machine();
    const s = await withSminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const share = await record(a, f, 'record.shares', { appSessionId: 'app-b', member: org.B, grade: 'view' });
    const { rpc } = await sent(a, s, share);
    const from = a.inbox.length;
    await a.channel.send({ t: 'query', opId: share.opId, opCreated: share.opCreated, executor: 'sminos' });
    await s.next((x) => x.t === 'query' && x.opId === share.opId, 'the device’s query');
    s.send({ t: 'queried', opId: share.opId, state: 'done', member: org.A, device: 'a1', fingerprint: rpc.fingerprint, target: { kind: 'session', session: 'eng-b' }, outcome: { state: 'done', result: { changed: true, policyRev: 8 } } });
    const answer = await until(() => a.inbox.slice(from).find((m) => m.t === 'queried' && (m as { opId?: string }).opId === share.opId) as Record<string, unknown> | undefined, 'the answer');
    expect(answer).toMatchObject({ state: 'done', outcome: { state: 'done', result: { changed: true, policyRev: 8 } } });
  });
});

describe('record.policy', () => {
  it('answers the policy of each session the caller owns, from sminos’s member frames; a frame without a policyRev `unavailable`', async () => {
    const f = await machine();
    await withSminos(f, ['audience', 'record'], [laneA(), laneB(), laneAMember({ session: 'la-2', policyRev: undefined }), laneAMember({ session: 'la-b', owners: [org.B], policyRev: 1 })]);
    const a = await openRemote(f, org.a1, org.A);
    const result = await call(a, 'record.policy', null);
    expect(result.ok).toBe(true);
    const output = result.output as { supported: boolean; policies: Array<Record<string, unknown>> };
    expect(output.supported).toBe(true);
    expect(output.policies.sort((x, y) => String(x.session).localeCompare(String(y.session)))).toEqual([
      { session: 'app-b', access: 'private', shares: [{ member: org.B, grade: 'list' }], policyRev: 7 },
      { session: 'la-1', access: 'listed', shares: [], policyRev: 3 },
      { session: 'la-2', unavailable: true },
    ]);
  });

  it('names one session by its listing’s id; one the caller doesn’t own, or that no frame holds, answers `unavailable` alike', async () => {
    const f = await machine();
    await withSminos(f);
    const a = await openRemote(f, org.a1, org.A);
    const b = await openRemote(f, org.b1, org.B);
    expect((await call(a, 'record.policy', { session: 'app-b' })).output).toEqual({ supported: true, policies: [{ session: 'app-b', access: 'private', shares: [{ member: org.B, grade: 'list' }], policyRev: 7 }] });
    expect((await call(b, 'record.policy', { session: 'app-b' })).output, 'shared with B, not B’s').toEqual({ supported: true, policies: [{ session: 'app-b', unavailable: true }] });
    expect((await call(a, 'record.policy', { session: 'app-none' })).output, 'no such session').toEqual({ supported: true, policies: [{ session: 'app-none', unavailable: true }] });
    expect((await call(b, 'record.policy', null)).output, 'B owns none').toEqual({ supported: true, policies: [] });
  });

  it('answers `{supported: false}` while sminos doesn’t advertise `record`, `unavailable` with none, and refuses another input', async () => {
    const f = await machine();
    const a = await openRemote(f, org.a1, org.A);
    expect(await call(a, 'record.policy', null)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    await withSminos(f, ['audience']);
    expect((await call(a, 'record.policy', null)).output).toEqual({ supported: false });
    expect(await call(a, 'record.policy', { session: 'la-1', all: true })).toMatchObject({ ok: false, error: { code: 'malformed' } });
  });
});

describe('the welcome’s `record`', () => {
  it('is advertised when this build serves the record acts, and not by a build without them', async () => {
    const f = await machine();
    const s = await withSminos(f);
    expect(s.received.find((x) => x.t === 'welcome')?.capabilities).toEqual(['access', 'reach', 'record']);
    const without: Offers = { ...OFFERS, commands: Object.fromEntries(Object.entries(OFFERS.commands).filter(([name]) => !name.startsWith('record.'))) };
    const g = await machine({ offers: without });
    const t = await sminos(g, [laneA()], ['audience', 'record']);
    expect(t.received.find((x) => x.t === 'welcome')?.capabilities).toEqual(['access', 'reach']);
  });
});

describe('the local door', () => {
  /** A device of the org's (or not), sealing actions for this machine as a channel's device would, its step-up key its own. */
  const sealer = async (f: Fixture, who: TestDevice, member: string) => (await openRemote(f, who, member)).device;

  it('takes a good record act as a channel does: authorized against the head, sent to sminos, its outcome the answer', async () => {
    const f = await machine();
    const s = await withSminos(f);
    const a = await sealer(f, org.a1, org.A);
    const access = await a.stepUp(a.action({ machine: f.ref, action: 'record.access', args: { appSessionId: 'app-b', access: 'listed' } }));
    const answered = f.endpoint.local.act(access);
    await s.next((x) => x.t === 'query' && x.opId === access.opId, 'the admission query');
    s.send({ t: 'queried', opId: access.opId, state: 'not-received' });
    const rpc = (await s.next((x) => x.t === 'rpc', 'the rpc')).rpc as Record<string, unknown>;
    expect(rpc).toMatchObject({ rpc: 'record.access', member: org.A, device: 'a1', args: { session: 'eng-b', access: 'listed' }, proof: access });
    s.send({ t: 'rpc-result', project: PROJECT, opId: access.opId, nonce: access.nonce, outcome: { state: 'done', result: { changed: true, policyRev: 8 } } });
    expect(await answered).toEqual({ state: 'done', result: { changed: true, policyRev: 8 } });
    // as a channel's: B's own device, its signature good, holds nothing on A's session; a replayed act is refused
    const b = await sealer(f, org.b1, org.B);
    expect(await f.endpoint.local.act(await b.stepUp(b.action({ machine: f.ref, action: 'record.access', args: { session: 'la-1', access: 'private' } })))).toEqual({ state: 'refused', reason: 'grade' });
    expect(await f.endpoint.local.act(access)).toEqual({ state: 'refused', reason: 'replayed' });
  });

  it('refuses an act with no step-up, one whose signature doesn’t verify, anything outside record.*, and a device the head doesn’t list', async () => {
    const f = await machine();
    const s = await withSminos(f);
    const a = await sealer(f, org.a1, org.A);
    const b = await sealer(f, org.b1, org.B);
    const access = (device = a) => device.action({ machine: f.ref, action: 'record.access', args: { session: 'la-1', access: 'private' } });
    expect(await f.endpoint.local.act(access()), 'no step-up').toEqual({ state: 'refused', reason: 'step-up' });
    // a present signature by another device's key (B signs what names a1), and one over other args
    const forged = { ...access(), stepUp: (await b.stepUp(access())).stepUp };
    expect(await f.endpoint.local.act(forged), 'another key’s signature').toEqual({ state: 'refused', reason: 'step-up' });
    const signed = await a.stepUp(access());
    expect(await f.endpoint.local.act({ ...signed, args: { session: 'la-1', access: 'org-converse' } }), 'args changed after signing').toEqual({ state: 'refused', reason: 'step-up' });
    // outside record.*, its signature good or not: a command that needs no step-up over a channel, and one that does
    const send = a.action({ machine: f.ref, action: 'sminos.send', session: 'la-1', context: { lane: 'A', session: 'la-1', launch: 'L1' }, args: { session: 'la-1', text: 'hi' } });
    expect(await f.endpoint.local.act({ ...send, stepUp: forged.stepUp }), 'a non-step-up command, a bad signature').toEqual({ state: 'refused', reason: 'not-offered' });
    expect(await f.endpoint.local.act(await a.stepUp(send)), 'a non-step-up command, signed').toEqual({ state: 'refused', reason: 'not-offered' });
    expect(await f.endpoint.local.act(await a.stepUp(a.action({ machine: f.ref, action: 'sminos.spawn', args: { checkout: '/work/m8' } }))), 'a step-up command').toEqual({ state: 'refused', reason: 'not-offered' });
    // a device of no member's
    const stranger = await newDevice('x1');
    const outsider = new Device({ identity: { org: ORG, member: org.A, device: 'x1', clientClass: 'native-mac', channelKey: stranger.channel, build: 'door', capabilities: [] }, org: memoryOrgView({ chain: [...f.chain] }), stepUpKey: stranger.stepUp });
    expect(await f.endpoint.local.act(await outsider.stepUp(outsider.action({ machine: f.ref, action: 'record.access', args: { session: 'la-1', access: 'private' } }))), 'an unlisted device').toEqual({ state: 'refused', reason: 'unknown-device' });
    expect(await f.endpoint.local.act({ nope: true }), 'no action').toEqual({ state: 'refused', reason: 'malformed' });
    await sleep(100);
    expect(s.received.filter((x) => x.t === 'query' || x.t === 'rpc')).toEqual([]);
  });

  it('refuses a device the head lists twice, as no one key verifies it (a head the org state refuses, held to the rule all the same)', async () => {
    const f = await machine();
    const head = structuredClone(f.chain.at(-1)!.state);
    head.members.find((m) => m.id === org.A)!.devices.push(org.b1.device);
    let handed = false;
    const door = new LocalDoor({ head: () => head, act: () => void (handed = true), policy: async () => ({ ok: false, code: 'unused' }), log: () => {} });
    const b = await sealer(f, org.b1, org.B);
    expect(await door.act(await b.stepUp(b.action({ machine: f.ref, action: 'record.access', args: { session: 'la-1', access: 'private' } })))).toEqual({ state: 'refused', reason: 'unknown-device' });
    expect(handed).toBe(false);
  });

  it('answers record.policy as the machine’s owners’ member, and no other call', async () => {
    const f = await machine();
    await withSminos(f, ['audience', 'record'], [laneA(), laneB(), laneAMember({ session: 'la-b', owners: [org.B], policyRev: 1, access: 'listed' })]);
    const answer = (await f.endpoint.local.call('record.policy', null)) as { ok: true; output: { supported: true; policies: Array<{ session: string }> } };
    expect(answer.ok).toBe(true);
    expect(answer.output.policies.map((p) => p.session).sort()).toEqual(['app-b', 'la-1']);
    expect(await f.endpoint.local.call('record.policy', { session: 'la-b' }), 'B’s, not the owners’').toEqual({ ok: true, output: { supported: true, policies: [{ session: 'la-b', unavailable: true }] } });
    expect(await f.endpoint.local.call('endpoint.listings', null)).toEqual({ ok: false, code: 'not-offered' });
    expect(await f.endpoint.local.call('record.policy', { session: 7 })).toEqual({ ok: false, code: 'malformed' });
  });
});
