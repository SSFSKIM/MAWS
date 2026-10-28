// Actions to their executing side (O10 M7; RL4, RL §4.7; acceptance 3's action cases). Every action reaches a started,
// enrolled endpoint through a real RL2 channel (the direct listener, at loopback), and goes to the side that runs it:
//   - lane B to the engine host's ledger: the fake services answer `host.op` and `host.opQuery` with the engine host's
//     own commands (src/engine-host/ops.ts) over a real ledger file and a stand-in handler table;
//   - lane A to sminos over the real RL10 socket, where a fake sminos plays the ledger's side;
//   - the endpoint's own (`endpoint.grant`, `endpoint.state`) to its own ledger.
// The org: A, an admin who owns the machine (device a1); B, a member (b1).
import * as fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionFingerprint, base64urlEncode, generateSigningKey, keyId, memoryOrgView, NO_CERTIFICATES, OP_HORIZON_S, signRecord, SIGNING_DOMAINS, type Action, type Channel, type ChannelMessage, type Grant, type SignedOrgState, type SigningKey } from 'org-protocol';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SoftwareAuthenticator } from '../../apps/org-protocol/test-support/authenticator.ts';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import type { SessionEvent } from '@shared/graph/events';
import type { HandlerContext } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { OpLedger } from '@shared/host/op-ledger';
import { requestDigestOf } from '@shared/host/request-digest';
import type { CommandInput } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { opCommands } from '../../src/engine-host/ops';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import { OFFERS, type Offers } from '../../src/endpoint/offers';
import { EndpointOrg } from '../../src/endpoint/org-sync';
import type { SessionRecord, SessionTarget } from '../../src/endpoint/sources';
import { EndpointState } from '../../src/endpoint/state/store';
import { dialDirect } from './carriers';
import { fakeServices, type FakeServices } from './fake-services';
import { endorsed, genesis, iso, memberId, newDevice, revokedDevice, successor, type TestDevice } from './org-fixtures';
import { FakeSminos, type Frame } from './rl10/fake-sminos';

const ORG = 'org-m7';
const TAILNET = '100.101.102.105';
const HUB = 'http://127.0.0.1:9';
const CHECKOUT = '/work/m7';
const PROJECT = 'proj-m7';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const A = memberId();
const B = memberId();
let a1: TestDevice;
let b1: TestDevice;
let recovery: SigningKey;
let hostDir: string;

beforeAll(async () => {
  a1 = await newDevice('a1');
  b1 = await newDevice('b1');
  recovery = await generateSigningKey();
});

// ---- The engine host, as `mawsd` dispatches to it -------------------------------------------------------------------

const PENDING = { kind: 'question.requested', requestId: 'rq-1', toolUseId: 't1', questions: [{ question: 'which?' }] } as unknown as SessionEvent;
const CTX = { client: {} } as HandlerContext;

/** The engine host: its sessions (appSessionId → launch and engine id), its handlers, and its ledger file. */
function engineHost() {
  const sessions: Record<string, { launchId: string; engineSessionId: string }> = {
    'app-own': { launchId: 'launch-1', engineSessionId: 'eng-own' },
    'app-shared': { launchId: 'launch-1', engineSessionId: 'eng-shared' },
  };
  const runs: string[] = [];
  let hang = false;
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>([
    ['session.send', async (input) => (runs.push(`send ${(input as { content: string }).content}`), { messageUuid: null, disposition: 'queued', queueId: `q${runs.length}` })],
    ['session.answer', async () => (runs.push('answer'), { outcome: 'delivered' })],
    ['session.interrupt', async () => (hang ? new Promise(() => {}) : (runs.push('interrupt'), { stillQueued: [], cancelled: [] }))],
  ]);
  let ops = opCommands({
    ledger: OpLedger.open(hostDir, 'ops.jsonl'),
    handler: (name) => handlers.get(name),
    status: (id) => sessions[id] ?? null,
    pending: (id, requestId) => (requestId === 'rq-1' && sessions[id] !== undefined ? PENDING : null),
  });
  const ok = (value: unknown): HostResponse => ({ t: 'res', id: '0', ok: true, value });
  const no = (code: 'unknown_command' | 'internal' | 'invalid_input'): HostResponse => ({ t: 'res', id: '0', ok: false, error: { code, message: code } });
  const dispatch = async (owner: string, name: string, input: unknown): Promise<HostResponse> => {
    if (owner !== 'engine-host') return no('unknown_command');
    const { appSessionId, requestId } = (input ?? {}) as { appSessionId?: string; requestId?: string };
    if (name === 'session.status') return appSessionId !== undefined && sessions[appSessionId] !== undefined ? ok({ appSessionId, ...sessions[appSessionId] }) : no('internal');
    if (name === 'session.pendingRequest') return ok({ event: requestId === 'rq-1' ? PENDING : null });
    if (name === 'host.op' || name === 'host.opQuery') {
      // The runtime checks every input against the registry before a handler sees it.
      const checked = validateCommandInput(name, input);
      if (!checked.ok) return no('invalid_input');
      return ok(name === 'host.op' ? await ops.op(checked.value as CommandInput<'host.op'>, CTX) : ops.opQuery(checked.value as CommandInput<'host.opQuery'>));
    }
    return no('unknown_command');
  };
  return {
    sessions,
    runs,
    dispatch,
    hangInterrupt: () => (hang = true),
    /** The engine host killed and started again: its ledger read from the file. */
    restart: () => {
      hang = false;
      ops = opCommands({ ledger: OpLedger.open(hostDir, 'ops.jsonl'), handler: (name) => handlers.get(name), status: (id) => sessions[id] ?? null, pending: () => PENDING });
    },
  };
}

// ---- A started, enrolled endpoint -----------------------------------------------------------------------------------

type Fixture = {
  endpoint: Endpoint;
  services: FakeServices;
  host: ReturnType<typeof engineHost>;
  records: Map<string, SessionRecord>;
  ref: string;
  key: SigningKey;
  chain: SignedOrgState[];
  port: () => number;
  sminos?: FakeSminos;
};
const started: Fixture[] = [];

afterEach(async () => {
  for (const f of started.splice(0)) {
    f.sminos?.close();
    await f.endpoint.stop();
    f.services.cleanup();
  }
  if (hostDir !== undefined) fs.rmSync(hostDir, { recursive: true, force: true });
});

type Options = { offers?: Offers; services?: FakeServices; host?: ReturnType<typeof engineHost>; records?: Map<string, SessionRecord>; chain?: SignedOrgState[]; key?: SigningKey };

async function start(options: Options = {}): Promise<Fixture> {
  if (options.host === undefined) {
    hostDir = fs.mkdtempSync(join(tmpdir(), 'm7-host-'));
    fs.chmodSync(hostDir, 0o700);
  }
  const host = options.host ?? engineHost();
  const services = options.services ?? fakeServices();
  services.dispatch = (owner, name, input) => host.dispatch(owner, name, input);
  const ref = services.machine.ref;
  const key = options.key ?? (await generateSigningKey(true));
  let chain = options.chain;
  if (chain === undefined) {
    const kid = await keyId(key.pub);
    const s1 = await genesis(ORG, A, a1, recovery);
    const s2 = await successor(s1, [a1], (s) => {
      s.members.push({ id: B, email: 'b@example.com', role: 'member', devices: [b1.device] });
      s.machines.push({ name: 'mini', ref, pub: key.pub, owners: [A] });
      s.machineNames.push({ name: 'mini', ref });
    });
    chain = [s1, s2];
    const state = EndpointState.open(services.machine.stateDir);
    state.setMachineKey({ version: 1, keyId: kid, jwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey, created: iso(Date.now()) });
    state.setLedger({ version: 1, heldKeys: [kid], grants: {}, highWater: {} });
    state.setEnrollment({ version: 1, state: 'org-listed', name: 'mini', ref, org: ORG, hub: HUB, enrollment: 'e'.repeat(32), credentials: { clientId: 'id', clientSecret: 'secret' }, at: iso(Date.now()) });
    state.setOrg({ version: 1, org: ORG, pinned: { roots: s1.state.root.keys, recoveryPub: recovery.pub }, head: null, chain: [], hashes: [], certificates: NO_CERTIFICATES, acceptedTransitions: [], highWater: 0 });
    await new EndpointOrg(state, { log: () => {} }).adopt(chain, []);
  }
  let port = 0;
  const listen = (server: Server) =>
    new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((port = (server.address() as AddressInfo).port)));
    });
  const records =
    options.records ??
    new Map<string, SessionRecord>([
      ['eng-own', { lane: 'B', session: 'eng-own', owners: ['@machine'] }],
      ['eng-shared', { lane: 'B', session: 'eng-shared', owners: [A], shares: [{ member: B, grade: 'view' }] }],
    ]);
  let endpoint: Endpoint | null = null;
  endpoint = createEndpoint({
    sleep: (ms) => sleep(Math.min(ms, 50)),
    env: { MAWS_ENDPOINT_DIRECT: '1' },
    direct: { interfaces: () => ({ utun4: [{ address: TAILNET, family: 'IPv4', internal: false, netmask: '255.255.255.255', mac: '00:00:00:00:00:00', cidr: null }] }), listen },
    authorization: {
      // Lane B's records are the suite's; lane A's are RL10's members, as sminos reports them.
      records: { record: (t: SessionTarget) => (t.lane === 'B' ? (records.get(t.session) ?? null) : (endpoint?.rl10.members.record(t) ?? null)), onChange: () => () => {} },
      checkouts: { known: (path) => endpoint?.rl10.members.known(path) ?? false },
      settingsMode: () => 'default',
      offers: options.offers,
    },
  });
  await endpoint.start(services);
  const f: Fixture = { endpoint, services, host, records, ref, key, chain, port: () => port };
  started.push(f);
  for (let i = 0; port === 0; i++) {
    if (i > 200) throw new Error('the direct listener never bound');
    await sleep(10);
  }
  return f;
}

/** The fake sminos on the endpoint's RL10 socket, welcomed, reporting one lane A session `la-1` with a bridge `L1`. */
async function sminos(f: Fixture, launch: string | undefined = 'L1'): Promise<FakeSminos> {
  const path = join(f.services.machine.stateDir, 'rl10.json');
  for (let i = 0; !fs.existsSync(path); i++) {
    if (i > 300) throw new Error('rl10.json never appeared');
    await sleep(10);
  }
  const info = JSON.parse(fs.readFileSync(path, 'utf8')) as { socket: string; token: string };
  const s = await FakeSminos.open(info.socket);
  s.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'test' }, policy: { read_only: false, ceiling: 'settings' } });
  await s.next((x) => x.t === 'welcome', 'welcome');
  s.send({ t: 'session', message: { project: PROJECT, machine: 'mini', session: null, kind: 'machine', sub: null, n: null, body: { online: true, policy: { read_only: false, ceiling: 'settings' }, checkouts: [{ path: CHECKOUT, branch: 'main' }], desk: {} } } });
  member(s, launch);
  s.send({ t: 'restated' });
  await until(() => f.endpoint.rl10.members.get('la-1') !== null && f.endpoint.rl10.members.known(CHECKOUT), 'the lane A member and presence');
  f.sminos = s;
  return s;
}

function member(s: FakeSminos, launch: string | undefined): void {
  s.send({ t: 'member', session: 'la-1', alias: 'main', project: PROJECT, lane: 'A', state: 'idle', title: 'main', cwd: CHECKOUT, ...(launch === undefined ? {} : { launch }), owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' } });
}

async function until<T>(check: () => T | null | false | undefined, what: string, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value !== null && value !== false && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(5);
  }
}

// ---- A device on a channel ------------------------------------------------------------------------------------------

type Remote = { device: Device; channel: Channel; inbox: ChannelMessage[] };

async function open(f: Fixture, who: TestDevice, member: string): Promise<Remote> {
  const device = new Device({
    identity: { org: ORG, member, device: who.device.id, clientClass: who.device.class, channelKey: who.channel, build: 'actions', capabilities: [] },
    org: memoryOrgView({ chain: [...f.chain] }),
    stepUpKey: who.stepUp,
  });
  const channel = await device.open(() => dialDirect(`ws://127.0.0.1:${f.port()}`), f.ref);
  const inbox: ChannelMessage[] = [];
  channel.onMessage((m) => void inbox.push(m));
  return { device, channel, inbox };
}

const find = <T extends ChannelMessage>(remote: Remote, match: (m: ChannelMessage) => boolean, what: string, from = 0) => until(() => remote.inbox.slice(from).find(match) as T | undefined, what);

/** The ack: `ok` when accepted, else the refusal's reason. */
async function act(remote: Remote, action: Action): Promise<string> {
  const from = remote.inbox.length;
  await remote.channel.send({ t: 'act', action });
  const m = await find<{ t: 'ack'; state: string; reason?: string } & ChannelMessage>(remote, (x) => x.t === 'ack' && x.opId === action.opId, `the ack of ${action.action}`, from);
  return m.state === 'accepted' ? 'ok' : m.reason!;
}

/** The `done` of an accepted action. */
async function done(remote: Remote, action: Action, from = 0): Promise<unknown> {
  const m = await find<{ t: 'done'; outcome: unknown } & ChannelMessage>(remote, (x) => x.t === 'done' && x.opId === action.opId, `the done of ${action.action}`, from);
  return m.outcome;
}

/** An accepted action's outcome. */
async function run(remote: Remote, action: Action): Promise<unknown> {
  const from = remote.inbox.length;
  expect(await act(remote, action)).toBe('ok');
  return done(remote, action, from);
}

async function query(remote: Remote, opId: string, opCreated: string, executor: 'sminos' | 'engine-host' | 'endpoint'): Promise<Record<string, unknown>> {
  const from = remote.inbox.length;
  await remote.channel.send({ t: 'query', opId, opCreated, executor });
  const m = await find(remote, (x) => x.t === 'queried' && x.opId === opId, `the answer to a query of ${opId}`, from);
  const rest: Record<string, unknown> = { ...(m as unknown as Record<string, unknown>) };
  delete rest.t;
  delete rest.opId;
  return rest;
}

const laneB = (f: Fixture, r: Remote, name: string, appSessionId: string, args: Record<string, unknown> = {}, context = f.host.sessions[appSessionId] ?? { launchId: 'launch-1', engineSessionId: 'none' }): Action =>
  r.device.action({ machine: f.ref, action: name, session: appSessionId, context: { lane: 'B', ...context }, args: { appSessionId, ...args } });
const send = (f: Fixture, r: Remote, content = 'hello', appSessionId = 'app-own') => laneB(f, r, 'session.send', appSessionId, { content });
const laneA = (f: Fixture, r: Remote, rpc: string, args: Record<string, unknown> = {}, launch = 'L1'): Action =>
  r.device.action({ machine: f.ref, action: `sminos.${rpc}`, session: 'la-1', context: { lane: 'A', session: 'la-1', launch }, args: { session: 'la-1', ...args } });
/** Bob's own lane A session `la-b` (owners [B], bridge `LB`), and a steer of it by Bob. */
async function bobsSession(f: Fixture, s: FakeSminos): Promise<void> {
  s.send({ t: 'member', session: 'la-b', alias: 'bob', project: PROJECT, lane: 'A', state: 'idle', title: 'bob', cwd: CHECKOUT, launch: 'LB', owners: [B], ownersProof: [], origin: { kind: 'terminal' } });
  await until(() => f.endpoint.rl10.members.get('la-b') !== null, 'Bob’s lane A member');
}
const bobsSteer = (f: Fixture, b: Remote): Action => b.device.action({ machine: f.ref, action: 'sminos.steer', session: 'la-b', context: { lane: 'A', session: 'la-b', launch: 'LB' }, args: { session: 'la-b', text: 'bob' } });
/** The endpoint stopped and started again on the same machine state, engine host and org; its sminos gone with it. */
async function restartEndpoint(f: Fixture): Promise<Fixture> {
  f.sminos?.close();
  await f.endpoint.stop();
  started.splice(started.indexOf(f), 1);
  return start({ services: f.services, host: f.host, records: f.records, chain: f.chain, key: f.key });
}

/**
 * A lane A copy's act when the endpoint asks sminos whose the op is first: its admission query answered `answer`
 * (sminos holding nothing, by default), then the ack.
 */
async function actA(remote: Remote, s: FakeSminos, action: Action, answer: Record<string, unknown> = { state: 'not-received' }): Promise<string> {
  const acked = act(remote, action);
  await s.next((x) => x.t === 'query' && x.opId === action.opId, `the admission query of ${action.opId}`);
  s.send({ t: 'queried', opId: action.opId, ...answer });
  return acked;
}
/** sminos's answer for an op it holds, bound to `member` and the forwarded rpc's fingerprint. */
const boundTo = (member: string, rpc: Record<string, unknown>) => ({ state: 'in-progress', member, device: rpc.device, fingerprint: rpc.fingerprint, target: { kind: 'session', session: 'la-1' } });
const aged = (a: Action, createdAgo: number, opCreatedAgo = createdAgo): Action => ({ ...a, created: iso(Date.now() - createdAgo), opCreated: iso(Date.now() - opCreatedAgo) });

async function grantFor(f: Fixture, member: string, version = 1): Promise<unknown> {
  const body: Grant = { org: ORG, machine: f.ref, machineKey: await keyId(f.key.pub), member, rights: ['spawn'], version, issued: iso(Date.now()) };
  return signRecord(SIGNING_DOMAINS.grant, body, a1.stepUp.privateKey, a1.stepUp.pub);
}

// ---- The endpoint's checks ------------------------------------------------------------------------------------------

describe('the endpoint’s checks, before anything is handed on', () => {
  it('refuses an action whose `created` is more than 60 s from the machine’s clock either way (`stale`)', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    expect(await act(a, aged(send(f, a), 61_000))).toBe('stale');
    expect(await act(a, aged(send(f, a), -61_000, 0))).toBe('stale');
    expect(f.host.runs).toEqual([]);
  });

  it('refuses an action whose operation is older than OP_HORIZON (`expired`), and its query `expired` whether or not a ledger holds it', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    const old = aged(send(f, a), 0, OP_HORIZON_S * 1000 + 1000);
    expect(await act(a, old)).toBe('expired');
    const kept = send(f, a);
    await run(a, kept);
    expect(await query(a, kept.opId, iso(Date.now() - OP_HORIZON_S * 1000 - 1000), 'engine-host')).toEqual({ state: 'expired' });
    expect(await query(a, old.opId, old.opCreated, 'engine-host')).toEqual({ state: 'expired' });
  });

  it('refuses a nonce this device used in the last 120 s (`replayed`): the action runs once', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    const action = send(f, a);
    await run(a, action);
    expect(await act(a, action)).toBe('replayed');
    expect(f.host.runs).toEqual(['send hello']);
  });

  it('refuses an action whose own fields disagree with its args, or that carries another lane’s context (`malformed`)', async () => {
    const f = await start();
    await sminos(f);
    const a = await open(f, a1, A);
    const steer = laneA(f, a, 'steer', { text: 'go' });
    expect(await act(a, { ...steer, context: { lane: 'A', session: 'la-other', launch: 'L1' } })).toBe('malformed');
    const lane = send(f, a);
    expect(await act(a, { ...lane, context: { lane: 'A', session: 'app-own', launch: 'L1' } })).toBe('malformed');
    expect(f.host.runs).toEqual([]);
  });

  it('refuses an action for an executor that keeps no ledger (`no-ledger`): pty.spawn, daemon.restart', async () => {
    const offers: Offers = {
      ...OFFERS,
      commands: {
        ...OFFERS.commands,
        'pty.spawn': { kind: 'act', executor: 'pty-host', target: 'machine', grade: 'shell' },
        'daemon.restart': { kind: 'act', executor: 'machine', target: 'machine', grade: 'machine-admin' },
      },
    };
    const f = await start({ offers });
    const a = await open(f, a1, A);
    expect(await act(a, await a.device.stepUp(a.device.action({ machine: f.ref, action: 'pty.spawn', args: {} })))).toBe('no-ledger');
    expect(await act(a, await a.device.stepUp(a.device.action({ machine: f.ref, action: 'daemon.restart', args: {} })))).toBe('no-ledger');
  });
});

// ---- Lane B: the engine host's ledger -------------------------------------------------------------------------------

describe('lane B, through the engine host’s ledger', () => {
  it('runs an action once: a reseal is answered from the ledger, the session showing one effect', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    const action = send(f, a);
    const first = await run(a, action);
    expect(first).toEqual({ state: 'done', result: { messageUuid: null, disposition: 'queued', queueId: 'q1' } });
    expect(await run(a, a.device.reseal(action))).toEqual(first);
    expect(f.host.runs).toEqual(['send hello']);
  });

  it('refuses a reused opId with other arguments `op-conflict`', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    const action = send(f, a);
    await run(a, action);
    const other = a.device.action({ ...laneB(f, a, 'session.send', 'app-own', { content: 'something else' }), opId: action.opId, opCreated: action.opCreated });
    expect(await run(a, other)).toEqual({ state: 'refused', reason: 'op-conflict' });
    expect(f.host.runs).toEqual(['send hello']);
  });

  it('refuses an action sealed before a relaunch or a /clear (`context`), at the endpoint and again at the claim', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    const sealed = send(f, a);
    f.host.sessions['app-own'] = { launchId: 'launch-2', engineSessionId: 'eng-own' };
    expect(await act(a, sealed)).toBe('context');
    const cleared = laneB(f, a, 'session.send', 'app-own', { content: 'x' }, { launchId: 'launch-2', engineSessionId: 'eng-before-clear' });
    expect(await act(a, cleared)).toBe('context');
    expect(f.host.runs).toEqual([]);
  });

  it('refuses an answer whose request digest is not the pending request’s (`digest-mismatch`)', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    const answer = { requestId: 'rq-1', answer: { kind: 'question', answers: { 'which?': 'that' } } };
    const digest = requestDigestOf('app-own', PENDING)!;
    const wrong = a.device.action({ ...laneB(f, a, 'session.answer', 'app-own', answer), requestDigest: { ...digest, input_sha256: 'f'.repeat(64) } });
    expect(await run(a, wrong)).toEqual({ state: 'refused', reason: 'digest-mismatch' });
    const right = a.device.action({ ...laneB(f, a, 'session.answer', 'app-own', answer), requestDigest: digest });
    expect(await run(a, right)).toEqual({ state: 'done', result: { outcome: 'delivered' } });
  });

  it('answers a query only to the member who sent the operation, while they still hold `view` on its stored target', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    const b = await open(f, b1, B);
    // A sends on app-shared, which B can see (a view share): B's query of A's operation is refused, and says nothing.
    const action = send(f, a, 'from A', 'app-shared');
    await run(a, action);
    expect(await query(b, action.opId, action.opCreated, 'engine-host')).toEqual({ state: 'refused', reason: 'grade' });
    expect(await query(a, action.opId, action.opCreated, 'engine-host')).toMatchObject({ state: 'done', outcome: { state: 'done' } });
    // B's own operation; then B's share of its target withdrawn: refused, and naming another session B still sees
    // (B now holds view on app-own) changes nothing, the target being the one the ledger stored.
    f.records.set('eng-shared', { lane: 'B', session: 'eng-shared', owners: [A], shares: [{ member: B, grade: 'converse' }] });
    const bs = send(f, b, 'from B', 'app-shared');
    await run(b, bs);
    expect(await query(b, bs.opId, bs.opCreated, 'engine-host')).toMatchObject({ state: 'done' });
    f.records.set('eng-shared', { lane: 'B', session: 'eng-shared', owners: [A] });
    f.records.set('eng-own', { lane: 'B', session: 'eng-own', owners: ['@machine'], shares: [{ member: B, grade: 'view' }] });
    expect(await query(b, bs.opId, bs.opCreated, 'engine-host')).toEqual({ state: 'refused', reason: 'grade' });
  });

  it('answers `not-received` only once the id is tombstoned: the original arriving later is refused and never runs', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    const lost = send(f, a, 'lost');
    expect(await query(a, lost.opId, lost.opCreated, 'engine-host')).toEqual({ state: 'not-received' });
    expect(await run(a, lost)).toEqual({ state: 'refused', reason: 'tombstoned' });
    expect(f.host.runs).toEqual([]);
  });

  it('answers `in-progress` for an op the engine host claimed and died before finishing, and each state after an endpoint restart', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    f.host.hangInterrupt();
    const interrupt = laneB(f, a, 'session.interrupt', 'app-own', { cancelEngineQueued: false });
    expect(await act(a, interrupt)).toBe('ok');
    const sent = send(f, a);
    await run(a, sent);
    f.host.restart();
    // The endpoint restarts too; nothing of the operations was its own to keep.
    await f.endpoint.stop();
    started.splice(started.indexOf(f), 1);
    const g = await start({ services: f.services, host: f.host, records: f.records, chain: f.chain, key: f.key });
    const a2 = await open(g, a1, A);
    expect(await query(a2, interrupt.opId, interrupt.opCreated, 'engine-host')).toEqual({ state: 'in-progress' });
    expect(await query(a2, sent.opId, sent.opCreated, 'engine-host')).toMatchObject({ state: 'done', outcome: { state: 'done' } });
    expect(await query(a2, 'never-sent-op-0001', iso(Date.now()), 'engine-host')).toEqual({ state: 'not-received' });
  });

  it('holds mawsd while an action is in flight, and answers no new action once stopping', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    f.host.hangInterrupt();
    expect(await act(a, laneB(f, a, 'session.interrupt', 'app-own', { cancelEngineQueued: false }))).toBe('ok');
    await until(() => [...f.services.holds].some((h) => h.startsWith('op#')), 'the op hold');
    const stopping = f.endpoint.stop();
    const at = Date.now();
    await stopping;
    expect(Date.now() - at).toBeGreaterThanOrEqual(1500); // waited, up to 2 s, for the result to be recorded
    expect([...f.services.holds].some((h) => h.startsWith('op#'))).toBe(false);
  });
});

// ---- Lane A: sminos's ledger over RL10 ------------------------------------------------------------------------------

describe('lane A, through sminos’s ledger over RL10', () => {
  it('hands an action down as an `rpc` and answers its result as `done`', async () => {
    const f = await start();
    const s = await sminos(f);
    const a = await open(f, a1, A);
    const steer = laneA(f, a, 'steer', { text: 'go on' });
    expect(await actA(a, s, steer)).toBe('ok');
    const rpc = (await s.next((x) => x.t === 'rpc', 'the rpc')).rpc as Record<string, unknown>;
    expect(rpc).toMatchObject({ rpc: 'steer', opId: steer.opId, nonce: steer.nonce, member: A, device: 'a1', context: { lane: 'A', session: 'la-1', launch: 'L1' } });
    s.send({ t: 'rpc-result', project: PROJECT, opId: steer.opId, nonce: steer.nonce, outcome: { state: 'done', result: {} } });
    expect(await done(a, steer)).toEqual({ state: 'done', result: {} });
    await s.next((x) => x.t === 'rpc-ack' && x.opId === steer.opId, 'the rpc-ack');
  });

  it('refuses a copy of a held op from another sender `op-conflict` and hands it nowhere: the op’s result stays its sender’s', async () => {
    const f = await start();
    const s = await sminos(f);
    await bobsSession(f, s);
    const a = await open(f, a1, A);
    const b = await open(f, b1, B);
    const alice = laneA(f, a, 'steer', { text: 'alice' });
    expect(await actA(a, s, alice)).toBe('ok');
    const aliceRpc = (await s.next((x) => x.t === 'rpc', 'Alice’s rpc')).rpc as Record<string, unknown>;
    // Bob, authorized on his own session, reuses Alice's pending opId under his own nonce.
    expect(await actA(b, s, { ...bobsSteer(f, b), opId: alice.opId, opCreated: alice.opCreated }, boundTo(A, aliceRpc))).toBe('op-conflict');
    s.send({ t: 'rpc-result', project: PROJECT, opId: alice.opId, nonce: alice.nonce, outcome: { state: 'done', result: { secret: 'alice' } } });
    expect(await done(a, alice)).toEqual({ state: 'done', result: { secret: 'alice' } });
    await sleep(50);
    expect(s.received.filter((x) => x.t === 'rpc')).toHaveLength(1);
    expect(b.inbox.filter((x) => x.t === 'done')).toEqual([]);
  });

  it('keeps an op its sender’s after the sender’s channel closed: another’s copy under its opId or nonce is refused, and its late result reaches no one', async () => {
    const f = await start();
    const s = await sminos(f);
    await bobsSession(f, s);
    const a = await open(f, a1, A);
    const alice = laneA(f, a, 'steer', { text: 'alice' });
    expect(await actA(a, s, alice)).toBe('ok');
    const aliceRpc = (await s.next((x) => x.t === 'rpc', 'Alice’s rpc')).rpc as Record<string, unknown>;
    a.channel.close('done');
    await until(() => f.endpoint.status().channels.direct === 0, 'Alice’s channel closed at the endpoint');
    const b = await open(f, b1, B);
    expect(await act(b, { ...bobsSteer(f, b), opId: alice.opId, opCreated: alice.opCreated, nonce: alice.nonce })).toBe('replayed');
    expect(await actA(b, s, { ...bobsSteer(f, b), opId: alice.opId, opCreated: alice.opCreated }, boundTo(A, aliceRpc))).toBe('op-conflict');
    s.send({ t: 'rpc-result', project: PROJECT, opId: alice.opId, nonce: alice.nonce, outcome: { state: 'done', result: { secret: 'alice' } } });
    await s.next((x) => x.t === 'rpc-ack' && x.opId === alice.opId, 'the rpc-ack');
    await sleep(50);
    expect(s.received.filter((x) => x.t === 'rpc')).toHaveLength(1);
    expect(b.inbox.filter((x) => x.t === 'done')).toEqual([]);
  });

  it('delivers a result sent under an earlier copy’s nonce after its sender resealed it', async () => {
    const f = await start();
    const s = await sminos(f);
    const a = await open(f, a1, A);
    const first = laneA(f, a, 'steer', { text: 'again' });
    expect(await actA(a, s, first)).toBe('ok');
    await s.next((x) => x.t === 'rpc' && (x.rpc as Record<string, unknown>).nonce === first.nonce, 'the first copy');
    const again = await open(f, a1, A);
    const copy: Action = { ...first, nonce: Buffer.from('resealed-copy-02').toString('base64url'), created: iso(Date.now()) };
    expect(await act(again, copy)).toBe('ok');
    await s.next((x) => x.t === 'rpc' && (x.rpc as Record<string, unknown>).nonce === copy.nonce, 'the resealed copy');
    // sminos answered the first copy before it read the reseal: the result comes under the earlier nonce.
    s.send({ t: 'rpc-result', project: PROJECT, opId: first.opId, nonce: first.nonce, outcome: { state: 'done', result: { first: true } } });
    expect(await done(again, copy)).toEqual({ state: 'done', result: { first: true } });
    expect(await done(a, first)).toEqual({ state: 'done', result: { first: true } });
  });

  it('refuses a copy under a nonce already handed down from another device (`replayed`), sending nothing down', async () => {
    const f = await start();
    const s = await sminos(f);
    await bobsSession(f, s);
    const a = await open(f, a1, A);
    const b = await open(f, b1, B);
    const alice = laneA(f, a, 'steer', { text: 'alice' });
    expect(await actA(a, s, alice)).toBe('ok');
    await s.next((x) => x.t === 'rpc', 'Alice’s rpc');
    expect(await act(b, { ...bobsSteer(f, b), opId: alice.opId, opCreated: alice.opCreated, nonce: alice.nonce })).toBe('replayed');
    s.send({ t: 'rpc-result', project: PROJECT, opId: alice.opId, nonce: alice.nonce, outcome: { state: 'done', result: { secret: 'alice' } } });
    expect(await done(a, alice)).toEqual({ state: 'done', result: { secret: 'alice' } });
    expect(s.received.filter((x) => x.t === 'rpc')).toHaveLength(1);
    expect(b.inbox.filter((x) => x.t === 'done')).toEqual([]);
  });

  it('asks sminos whose an op is before a first copy goes down: one bound to another, or to no RL10 sender, is `op-conflict` and goes nowhere', async () => {
    const f = await start();
    const s = await sminos(f);
    await bobsSession(f, s);
    const b = await open(f, b1, B);
    const held = bobsSteer(f, b);
    expect(await actA(b, s, held, { state: 'in-progress', member: A, device: 'a1', fingerprint: 'fp-alice', target: { kind: 'session', session: 'la-1' } })).toBe('op-conflict');
    const dx2 = bobsSteer(f, b);
    expect(await actA(b, s, dx2, { state: 'done', outcome: { state: 'done' } })).toBe('op-conflict');
    expect(await actA(b, s, bobsSteer(f, b), { state: 'unavailable' })).toBe('unavailable');
    await sleep(50);
    expect(s.received.filter((x) => x.t === 'rpc')).toEqual([]);
  });

  it('after an endpoint restart, takes sminos’s binding: another’s copy is refused under the op’s nonce or its own, and the sender’s reseal goes down and gets its result', async () => {
    const f = await start();
    const s = await sminos(f);
    await bobsSession(f, s);
    const a = await open(f, a1, A);
    const alice = laneA(f, a, 'steer', { text: 'alice' });
    expect(await actA(a, s, alice)).toBe('ok');
    const aliceRpc = (await s.next((x) => x.t === 'rpc', 'Alice’s rpc')).rpc as Record<string, unknown>;
    const g = await restartEndpoint(f);
    const s2 = await sminos(g);
    await bobsSession(g, s2);
    const b = await open(g, b1, B);
    const bound = boundTo(A, aliceRpc);
    expect(await actA(b, s2, { ...bobsSteer(g, b), opId: alice.opId, opCreated: alice.opCreated, nonce: alice.nonce }, bound)).toBe('op-conflict');
    expect(await actA(b, s2, { ...bobsSteer(g, b), opId: alice.opId, opCreated: alice.opCreated }, bound)).toBe('op-conflict');
    // sminos sends again the result the endpoint never acknowledged: it reaches no one but Alice's own copies.
    s2.send({ t: 'rpc-result', project: PROJECT, opId: alice.opId, nonce: alice.nonce, outcome: { state: 'done', result: { secret: 'alice' } } });
    await s2.next((x) => x.t === 'rpc-ack' && x.opId === alice.opId, 'the rpc-ack');
    const a2 = await open(g, a1, A);
    const reseal = a2.device.reseal(alice);
    expect(await actA(a2, s2, reseal, bound)).toBe('ok');
    await s2.next((x) => x.t === 'rpc' && (x.rpc as Record<string, unknown>).nonce === reseal.nonce, 'Alice’s reseal');
    s2.send({ t: 'rpc-result', project: PROJECT, opId: alice.opId, nonce: reseal.nonce, outcome: { state: 'done', result: { secret: 'alice' } } });
    expect(await done(a2, reseal)).toEqual({ state: 'done', result: { secret: 'alice' } });
    await sleep(50);
    expect(s2.received.filter((x) => x.t === 'rpc')).toHaveLength(1);
    expect(b.inbox.filter((x) => x.t === 'done')).toEqual([]);
  });

  it('tells a copy a failure by its code only, bound or not: a refusal before sminos’s ledger may be another sender’s, under a nonce reused after a restart', async () => {
    const f = await start();
    const s = await sminos(f);
    await bobsSession(f, s);
    const a = await open(f, a1, A);
    const alice = laneA(f, a, 'steer', { text: 'alice' });
    expect(await actA(a, s, alice)).toBe('ok');
    await s.next((x) => x.t === 'rpc', 'Alice’s rpc');
    // sminos refused Alice's copy before its ledger (kept by no binding), and the endpoint restarted before the refusal.
    const g = await restartEndpoint(f);
    const s2 = await sminos(g);
    await bobsSession(g, s2);
    const b = await open(g, b1, B);
    const bob = { ...bobsSteer(g, b), opId: alice.opId, opCreated: alice.opCreated, nonce: alice.nonce };
    expect(await actA(b, s2, bob)).toBe('ok');
    s2.send({ t: 'rpc-result', project: PROJECT, opId: alice.opId, nonce: alice.nonce, outcome: { state: 'failed', error: { code: 'no-session', message: 'session la-1 of project main-app is not here', winner: 'x' } } });
    expect(await done(b, bob)).toEqual({ state: 'failed', error: { code: 'no-session' } });
    // A copy admitted on sminos's binding of its own sender hears the code alone too: the binding is the ledger entry's,
    // not a loose refusal's under the same op and nonce. The whole outcome is the sender's by `query`.
    const own = bobsSteer(g, b);
    expect(await actA(b, s2, own, { state: 'in-progress', member: B, device: 'b1', fingerprint: await actionFingerprint(own), target: { kind: 'session', session: 'la-b' } })).toBe('ok');
    s2.send({ t: 'rpc-result', project: PROJECT, opId: own.opId, nonce: own.nonce, outcome: { state: 'failed', error: { code: 'read-only', message: 'the machine is read-only' } } });
    expect(await done(b, own)).toEqual({ state: 'failed', error: { code: 'read-only' } });
    // A `done` is whole.
    const ran = bobsSteer(g, b);
    expect(await actA(b, s2, ran)).toBe('ok');
    s2.send({ t: 'rpc-result', project: PROJECT, opId: ran.opId, nonce: ran.nonce, outcome: { state: 'done', result: { steered: true } } });
    expect(await done(b, ran)).toEqual({ state: 'done', result: { steered: true } });
  });

  it('never makes a copy sminos refused the op’s owner: the op’s own sender is asked about afresh and goes down', async () => {
    const f = await start();
    const s = await sminos(f);
    await bobsSession(f, s);
    const a = await open(f, a1, A);
    const b = await open(f, b1, B);
    const alice = laneA(f, a, 'steer', { text: 'alice' });
    // sminos held nothing yet when Bob's copy was asked about; by its arrival Alice's had bound the op.
    const bob = { ...bobsSteer(f, b), opId: alice.opId, opCreated: alice.opCreated };
    expect(await actA(b, s, bob)).toBe('ok');
    await s.next((x) => x.t === 'rpc' && (x.rpc as Record<string, unknown>).nonce === bob.nonce, 'Bob’s rpc');
    s.send({ t: 'rpc-result', project: PROJECT, opId: alice.opId, nonce: bob.nonce, outcome: { state: 'refused', reason: 'op-conflict' } });
    expect(await done(b, bob)).toEqual({ state: 'refused', reason: 'op-conflict' });
    expect(await actA(a, s, alice, { state: 'in-progress', member: A, device: 'a1', fingerprint: await actionFingerprint(alice), target: { kind: 'session', session: 'la-1' } })).toBe('ok');
    await s.next((x) => x.t === 'rpc' && (x.rpc as Record<string, unknown>).nonce === alice.nonce, 'Alice’s rpc');
    s.send({ t: 'rpc-result', project: PROJECT, opId: alice.opId, nonce: alice.nonce, outcome: { state: 'done', result: {} } });
    expect(await done(a, alice)).toEqual({ state: 'done', result: {} });
  });

  it('answers a resealed copy from the same sender under its latest nonce, on the channel that sent it', async () => {
    const f = await start();
    const s = await sminos(f);
    const a = await open(f, a1, A);
    const first = laneA(f, a, 'steer', { text: 'again' });
    expect(await actA(a, s, first)).toBe('ok');
    await s.next((x) => x.t === 'rpc' && (x.rpc as Record<string, unknown>).nonce === first.nonce, 'the first copy');
    const again = await open(f, a1, A);
    const copy: Action = { ...first, nonce: Buffer.from('resealed-copy-01').toString('base64url'), created: iso(Date.now()) };
    expect(await act(again, copy)).toBe('ok');
    await s.next((x) => x.t === 'rpc' && (x.rpc as Record<string, unknown>).nonce === copy.nonce, 'the resealed copy');
    s.send({ t: 'rpc-result', project: PROJECT, opId: first.opId, nonce: copy.nonce, outcome: { state: 'done', result: {} } });
    expect(await done(again, copy)).toEqual({ state: 'done', result: {} });
  });

  it('refuses an action sealed for another launch (`context`), and one on a session with no bridge (`unavailable`), sending nothing down', async () => {
    const f = await start();
    const s = await sminos(f);
    const a = await open(f, a1, A);
    expect(await act(a, laneA(f, a, 'steer', { text: 'x' }, 'L0'))).toBe('context');
    member(s, undefined);
    await until(() => f.endpoint.rl10.members.get('la-1')?.launch === undefined, 'the bridge gone');
    expect(await act(a, laneA(f, a, 'steer', { text: 'x' }))).toBe('unavailable');
    await sleep(200);
    expect(s.received.filter((x) => x.t === 'rpc')).toEqual([]);
  });

  it('resolves a spawn’s lost acknowledgement by query, answered with sminos’s binding', async () => {
    const f = await start();
    const s = await sminos(f);
    const a = await open(f, a1, A);
    const spawn = await a.device.stepUp(a.device.action({ machine: f.ref, action: 'sminos.spawn', args: { checkout: CHECKOUT, brief: 'fix it' } }));
    expect(await actA(a, s, spawn)).toBe('ok');
    const rpc = (await s.next((x) => x.t === 'rpc', 'the spawn rpc')).rpc as Record<string, unknown>;
    // The result never reaches the device (lost); it asks.
    const asked = query(a, spawn.opId, spawn.opCreated, 'sminos');
    const q = await s.next((x) => x.t === 'query' && x.opId === spawn.opId, 'the query');
    expect(q).toEqual({ t: 'query', opId: spawn.opId, opCreated: spawn.opCreated });
    s.send({ t: 'queried', opId: spawn.opId, state: 'done', outcome: { state: 'done', result: { session: 'la-new' } }, member: A, device: 'a1', fingerprint: rpc.fingerprint, target: { kind: 'machine' } });
    expect(await asked).toEqual({ state: 'done', outcome: { state: 'done', result: { session: 'la-new' } } });
  });

  it('refuses a web-cards asker a lane A session op `grade`: the binding names no operation, and its device id may once have been another class’s', async () => {
    const f = await start();
    const s = await sminos(f);
    s.send({ t: 'member', session: 'la-b', alias: 'bob', project: PROJECT, lane: 'A', state: 'idle', title: 'bob', cwd: CHECKOUT, launch: 'LB', owners: [B], ownersProof: [], origin: { kind: 'terminal' } });
    await until(() => f.endpoint.rl10.members.get('la-b') !== null, 'Bob’s lane A member');
    const b = await open(f, b1, B);
    const steer = b.device.action({ machine: f.ref, action: 'sminos.steer', session: 'la-b', context: { lane: 'A', session: 'la-b', launch: 'LB' }, args: { session: 'la-b', text: 'private' } });
    expect(await actA(b, s, steer)).toBe('ok');
    const rpc = (await s.next((x) => x.t === 'rpc', 'the steer rpc')).rpc as Record<string, unknown>;
    // B's Mac is replaced by newly endorsed web-cards keys under the same device id: a successor the org accepts.
    const phone = await newDevice('b1', 'web-cards');
    const passkey = new SoftwareAuthenticator(await generateSigningKey(), base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), 'hub.example');
    const card = { ...phone.device, passkey: passkey.passkey };
    delete card.stepUpPub;
    const bw = await endorsed(ORG, B, { ...phone, device: card }, b1);
    const gone = await revokedDevice(B, b1.device);
    const next = await successor(f.chain[f.chain.length - 1], [a1], (st) => {
      st.members.find((m) => m.id === B)!.devices = [bw.device];
      st.revoked.push(...gone);
    });
    const out = await f.endpoint.cli('revoke', ['-'], JSON.stringify(next));
    expect(out.code, out.out).toBe(0);
    f.chain.push(next);
    const w = await open(f, bw, B);
    const asked = query(w, steer.opId, steer.opCreated, 'sminos');
    await s.next((x) => x.t === 'query' && x.opId === steer.opId, 'the query');
    s.send({ t: 'queried', opId: steer.opId, state: 'done', outcome: { state: 'done', result: { secret: 'steered' } }, member: B, device: 'b1', fingerprint: rpc.fingerprint, target: { kind: 'session', session: 'la-b' } });
    expect(await asked).toEqual({ state: 'refused', reason: 'grade' });
  });

  it('answers `not-received` only after sminos’s tombstone took; one that fails returns the claim’s state; no binding reveals nothing', async () => {
    const f = await start();
    const s = await sminos(f);
    const a = await open(f, a1, A);
    const b = await open(f, b1, B);
    const answer = (frame: Frame) => s.send(frame);
    // Absent: queried not-received, then the tombstone took.
    const lost = laneA(f, a, 'steer', { text: 'lost' });
    let asked = query(a, lost.opId, lost.opCreated, 'sminos');
    await s.next((x) => x.t === 'query' && x.opId === lost.opId, 'the query');
    answer({ t: 'queried', opId: lost.opId, state: 'not-received' });
    await s.next((x) => x.t === 'tombstone' && x.opId === lost.opId, 'the tombstone');
    answer({ t: 'tombstoned', opId: lost.opId, ok: true });
    expect(await asked).toEqual({ state: 'not-received' });
    // The original claimed the id between the query and the tombstone: its state, after the binding check.
    const raced = laneA(f, a, 'steer', { text: 'raced' });
    asked = query(a, raced.opId, raced.opCreated, 'sminos');
    await s.next((x) => x.t === 'query' && x.opId === raced.opId, 'the query');
    answer({ t: 'queried', opId: raced.opId, state: 'not-received' });
    await s.next((x) => x.t === 'tombstone' && x.opId === raced.opId, 'the tombstone');
    answer({ t: 'tombstoned', opId: raced.opId, ok: false, state: 'in-progress', member: A, device: 'a1', fingerprint: 'fp', target: { kind: 'session', session: 'la-1' } });
    expect(await asked).toEqual({ state: 'in-progress' });
    // Another member asking about A's operation: nothing said.
    asked = query(b, raced.opId, raced.opCreated, 'sminos');
    await s.next((x) => x.t === 'query' && x.opId === raced.opId, 'B’s query');
    answer({ t: 'queried', opId: raced.opId, state: 'in-progress', member: A, device: 'a1', fingerprint: 'fp', target: { kind: 'session', session: 'la-1' } });
    expect(await asked).toEqual({ state: 'refused', reason: 'grade' });
    // An entry from before RL10 holds no binding: it can't be checked against the asker, so nothing is said.
    asked = query(a, 'ZHgyLWVyYS1vcC0wMDAwMDAwMQ', iso(Date.now()), 'sminos');
    await s.next((x) => x.t === 'query' && x.opId === 'ZHgyLWVyYS1vcC0wMDAwMDAwMQ', 'the DX2-era query');
    answer({ t: 'queried', opId: 'ZHgyLWVyYS1vcC0wMDAwMDAwMQ', state: 'done', outcome: { state: 'done' } });
    expect(await asked).toEqual({ state: 'refused', reason: 'grade' });
  });
});

// ---- The endpoint's own actions -------------------------------------------------------------------------------------

describe('the endpoint’s own actions, under its own ledger', () => {
  it('keeps a delivered grant once: a reseal is answered from the ledger; a reused opId with another grant is `op-conflict`', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    const grant = a.device.action({ machine: f.ref, action: 'endpoint.grant', args: { grant: await grantFor(f, B) } });
    const first = await run(a, grant);
    expect(first).toEqual({ state: 'done', result: { member: B, version: 1, rights: ['spawn'] } });
    expect(f.endpoint.parts!.state.ledger!.grants[B]?.body.version).toBe(1);
    expect(await run(a, a.device.reseal(grant))).toEqual(first);
    const other = a.device.action({ machine: f.ref, action: 'endpoint.grant', args: { grant: await grantFor(f, B, 2) }, opId: grant.opId, opCreated: grant.opCreated });
    expect(await run(a, other)).toEqual({ state: 'refused', reason: 'op-conflict' });
    expect(f.endpoint.parts!.state.ledger!.grants[B]?.body.version).toBe(1);
    expect(await query(a, grant.opId, grant.opCreated, 'endpoint')).toEqual({ state: 'done', outcome: first });
  });

  it('answers a delivered state `done` only once the new head is on disk', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    const next = await successor(f.chain[f.chain.length - 1], [a1], (s) => void (s.members[1].email = 'b2@example.com'));
    const outcome = await run(a, a.device.action({ machine: f.ref, action: 'endpoint.state', args: { states: [next], transitions: [] } }));
    expect(outcome).toEqual({ state: 'done', result: { version: next.state.version } });
    const onDisk = JSON.parse(fs.readFileSync(join(f.services.machine.stateDir, 'org.json'), 'utf8')) as { head: SignedOrgState };
    expect(onDisk.head.state.version).toBe(next.state.version);
  });

  it('refuses the original after a `not-received` tombstoned it, and answers each state after a restart', async () => {
    const f = await start();
    const a = await open(f, a1, A);
    const lost = a.device.action({ machine: f.ref, action: 'endpoint.grant', args: { grant: await grantFor(f, B) } });
    expect(await query(a, lost.opId, lost.opCreated, 'endpoint')).toEqual({ state: 'not-received' });
    const kept = a.device.action({ machine: f.ref, action: 'endpoint.grant', args: { grant: await grantFor(f, B, 3) } });
    await run(a, kept);
    await f.endpoint.stop();
    started.splice(started.indexOf(f), 1);
    const g = await start({ services: f.services, host: f.host, records: f.records, chain: f.chain, key: f.key });
    const a2 = await open(g, a1, A);
    expect(await run(a2, a2.device.reseal(lost))).toEqual({ state: 'refused', reason: 'tombstoned' });
    expect(await query(a2, kept.opId, kept.opCreated, 'endpoint')).toMatchObject({ state: 'done' });
    expect(await query(a2, lost.opId, lost.opCreated, 'endpoint')).toEqual({ state: 'not-received' });
  });

  it('answers every action and query `unavailable` while its ledger can’t be read', async () => {
    const services = fakeServices();
    fs.writeFileSync(join(services.machine.stateDir, 'ops.jsonl'), 'not json\n{}\n', { mode: 0o600 });
    const f = await start({ services });
    const a = await open(f, a1, A);
    const grant = a.device.action({ machine: f.ref, action: 'endpoint.grant', args: { grant: await grantFor(f, B) } });
    expect(await run(a, grant)).toEqual({ state: 'refused', reason: 'unavailable' });
    expect(await query(a, grant.opId, grant.opCreated, 'endpoint')).toEqual({ state: 'unavailable' });
  });
});

// ---- A closed ledger, shown -----------------------------------------------------------------------------------------

describe('a closed ledger, in the endpoint’s status', () => {
  it('shows its own ledger closed, and why, until mawsd restarts', async () => {
    const services = fakeServices();
    fs.writeFileSync(join(services.machine.stateDir, 'ops.jsonl'), 'garbage\n{}\n', { mode: 0o600 });
    const f = await start({ services });
    expect(f.endpoint.status().opLedgers).toEqual({ endpoint: { closed: 'unreadable', clears: 'restart' } });
    const a = await open(f, a1, A);
    expect(await run(a, a.device.action({ machine: f.ref, action: 'endpoint.grant', args: { grant: await grantFor(f, B) } }))).toEqual({ state: 'refused', reason: 'unavailable' });
  });

  it('shows the engine host’s ledger closed once it answers so, and clears it once the restarted host answers again', async () => {
    const f = await start();
    expect(f.endpoint.status().opLedgers).toBeUndefined();
    const a = await open(f, a1, A);
    fs.writeFileSync(join(hostDir, 'ops.jsonl'), 'garbage\n{}\n', { mode: 0o600 });
    f.host.restart();
    expect(await run(a, send(f, a, 'closed'))).toEqual({ state: 'refused', reason: 'unavailable' });
    expect(f.endpoint.status().opLedgers).toEqual({ engineHost: { closed: 'unreadable', clears: 'restart' } });
    fs.rmSync(join(hostDir, 'ops.jsonl'));
    f.host.restart();
    expect(await run(a, send(f, a, 'open again'))).toMatchObject({ state: 'done' });
    expect(f.endpoint.status().opLedgers).toBeUndefined();
  });

  it('keeps showing it while the engine host says so on a `done` or an `in-progress`, and tells the device neither', async () => {
    hostDir = fs.mkdtempSync(join(tmpdir(), 'm7-host-'));
    fs.chmodSync(hostDir, 0o700);
    const host = engineHost();
    const said = { ledger: 'write-failed' as string | undefined, inProgress: false };
    const dispatch = host.dispatch;
    host.dispatch = async (owner, name, input) => {
      const response = await dispatch(owner, name, input);
      if (name !== 'host.op' || !response.ok || said.ledger === undefined) return response;
      const value = said.inProgress ? { state: 'in-progress' } : (response.value as object);
      return { ...response, value: { ...value, ledger: said.ledger } };
    };
    const f = await start({ host });
    const a = await open(f, a1, A);
    expect(await run(a, send(f, a, 'ran as it closed'))).toMatchObject({ state: 'done', result: { disposition: 'queued' } });
    expect(f.endpoint.status().opLedgers).toEqual({ engineHost: { closed: 'write-failed', clears: 'restart' } });
    said.inProgress = true;
    expect(await run(a, send(f, a, 'held'))).toEqual({ state: 'in-progress' });
    expect(f.endpoint.status().opLedgers).toEqual({ engineHost: { closed: 'write-failed', clears: 'restart' } });
  });
});
