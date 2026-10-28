// The harness of M8's suites (O10 M8; RL3): a started, enrolled endpoint whose channels a test device opens over the
// direct listener at loopback, a fake engine host behind its `dispatch`, `onEvent` and `onAttachment` (lane B), the real
// RL10 socket with a fake sminos on it (lane A), and lane B's records in the suite's hands. The engine host keeps
// journal rows as the real one does: one row yields several events under one `seq`, each event's id is
// `<appSessionId>:<launchId>:<seq>:<i>`, `session.events` answers whole rows after `afterSeq`, and its live events reach
// the endpoint only while an app is attached (O2's seam until O3).
//
// The org: A, an admin who owns the machine (device a1); B, a member (b1); C, a member with a phone (c1, web-cards).
import * as fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { base64urlEncode, generateSigningKey, keyId, memoryOrgView, NO_CERTIFICATES, type Action, type ByteDuplex, type Channel, type ChannelMessage, type SignedOrgState, type SigningKey } from 'org-protocol';
import { SoftwareAuthenticator } from '../../apps/org-protocol/test-support/authenticator.ts';
import { TestDevice as Device } from '../../apps/org-protocol/test-support/test-device.ts';
import type { SessionEvent } from '@shared/graph/events';
import type { HandlerContext } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { OpLedger } from '@shared/host/op-ledger';
import type { CommandInput } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import { opCommands } from '../../src/engine-host/ops';
import { createEndpoint, type Endpoint } from '../../src/endpoint';
import type { EndpointOptions } from '../../src/endpoint/endpoint';
import { EndpointOrg } from '../../src/endpoint/org-sync';
import type { RecordSource, SessionRecord, SessionTarget } from '../../src/endpoint/sources';
import { EndpointState } from '../../src/endpoint/state/store';
import { dialDirect } from './carriers';
import { fakeServices, type FakeServices } from './fake-services';
import { genesis, iso, memberId, newDevice, successor, type TestDevice } from './org-fixtures';
import { FakeSminos, type Frame } from './rl10/fake-sminos';

export const ORG = 'org-m8';
export const PROJECT = 'proj-m8';
export const CHECKOUT = '/work/m8';
const TAILNET = '100.101.102.108';
export const HUB = 'http://127.0.0.1:9';
const RP_ID = 'hub.example';
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function until<T>(check: () => T | null | false | undefined, what: string, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value !== null && value !== false && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(5);
  }
}

// ---- The org ----------------------------------------------------------------------------------------------------------

export type Org = { A: string; B: string; C: string; a1: TestDevice; b1: TestDevice; c1: TestDevice; passkey: SoftwareAuthenticator; recovery: SigningKey };

export async function makeOrg(): Promise<Org> {
  // A web-cards device holds no step-up key (RL §5.10); its passkey signs its answers.
  const phone = await newDevice('c1', 'web-cards');
  const passkey = new SoftwareAuthenticator(await generateSigningKey(), base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), RP_ID);
  const c1 = { ...phone, device: { ...phone.device, passkey: passkey.passkey } };
  delete c1.device.stepUpPub;
  return { A: memberId(), B: memberId(), C: memberId(), a1: await newDevice('a1'), b1: await newDevice('b1'), c1, passkey, recovery: await generateSigningKey() };
}

// ---- The engine host, as mawsd's dispatch and events give it ---------------------------------------------------------

export type HostSession = {
  appSessionId: string;
  launchId: string;
  engineSessionId: string | null;
  /** The launch's journal rows, row `seq` at index `seq - 1`, each its events in emission order. */
  rows: SessionEvent[][];
  /**
   * The engine host's ring, as `SessionStream` keeps it: it dropped every event up to and including `evicted` (null:
   * none), cutting rows anywhere, so a read from before it is answered from the journal, or, when the journal can't be
   * read back (`journal` false), from the ring alone, `complete: false`.
   */
  evicted: { seq: number; idx: number } | null;
  journal: boolean;
  items: Array<Record<string, unknown>>;
  requests: Map<string, SessionEvent>;
  queue: Record<string, unknown>;
  catalog: Record<string, unknown>;
};

const ok = (value: unknown): HostResponse => ({ t: 'res', id: '0', ok: true, value });
const no = (code: 'unknown_command' | 'internal' | 'host_unavailable'): HostResponse => ({ t: 'res', id: '0', ok: false, error: { code, message: code } });

export class FakeEngineHost {
  readonly sessions = new Map<string, HostSession>();
  attached = false;
  /** Every dispatched command's name, in order. */
  readonly calls: Array<{ name: string; input: unknown }> = [];
  /** Answers held before they go (a read a test races): resolved by `release`. */
  readonly #held = new Map<string, Array<() => void>>();
  readonly #holding = new Set<string>();
  /** Commands answered `host_unavailable` (the engine host away, a read timed out) until `heal`. */
  readonly #failing = new Set<string>();
  readonly #events = new Set<(owner: 'engine-host' | 'pty-host', message: { name: string; payload: unknown }) => void>();
  readonly #attachments = new Set<(attached: boolean) => void>();
  #launches = 0;
  #ops: ReturnType<typeof opCommands> | null = null;
  /** Each answer the engine host delivered: `<appSessionId> <requestId>`. */
  readonly answered: string[] = [];

  /** Wires the fake into `services`' dispatch, onEvent and onAttachment, its op ledger in the machine's state directory. */
  serve(services: FakeServices): void {
    this.#ops = opCommands({
      ledger: OpLedger.open(services.machine.stateDir, 'host-ops.jsonl'),
      handler: (name) => (name === 'session.answer' ? (input) => Promise.resolve(this.#answer(input as { appSessionId: string; requestId: string })) : undefined),
      status: (id) => {
        const s = this.sessions.get(id);
        return s === undefined || s.engineSessionId === null ? null : { launchId: s.launchId, engineSessionId: s.engineSessionId };
      },
      pending: (id, requestId) => this.#pending(this.sessions.get(id), requestId),
    });
    services.dispatch = (owner, name, input) => this.dispatch(owner, name, input);
    services.onEvent = (listener) => {
      this.#events.add(listener);
      return () => this.#events.delete(listener);
    };
    services.onAttachment = (listener) => {
      this.#attachments.add(listener);
      return () => this.#attachments.delete(listener);
    };
  }

  add(appSessionId: string, engineSessionId: string | null = `eng-${appSessionId}`): HostSession {
    const session: HostSession = {
      appSessionId,
      launchId: `launch-${++this.#launches}`,
      engineSessionId,
      rows: [],
      evicted: null,
      journal: true,
      items: [],
      requests: new Map(),
      queue: { entries: [], paused: false, pauseReason: null },
      catalog: { commands: [], agents: [], skills: [], terminalSlashCommands: [], revision: 1 },
    };
    this.sessions.set(appSessionId, session);
    return session;
  }

  /** A new launch of the session: a new launchId, its journal from row 1. */
  relaunch(appSessionId: string): HostSession {
    const s = this.session(appSessionId);
    s.launchId = `launch-${++this.#launches}`;
    s.rows = [];
    s.evicted = null;
    s.journal = true;
    this.emit('session.status', { appSessionId, status: this.status(s) });
    return s;
  }

  session(appSessionId: string): HostSession {
    const s = this.sessions.get(appSessionId);
    if (s === undefined) throw new Error(`no host session ${appSessionId}`);
    return s;
  }

  /** Writes one journal row of `count` events and returns them; `live` emits them now, cut into batches at `cut`. */
  row(appSessionId: string, count = 1, options: { live?: boolean; cut?: number[] } = {}): SessionEvent[] {
    const s = this.session(appSessionId);
    const seq = s.rows.length + 1;
    const events = Array.from({ length: count }, (_, i) => this.event(s, seq, i, { kind: 'note', text: `row ${seq} event ${i}` }));
    s.rows.push(events);
    if (options.live !== false) this.batches(appSessionId, events, options.cut);
    return events;
  }

  /** A request row: the `*.requested` event, its broker item listed, both published. */
  request(appSessionId: string, kind: 'question' | 'permission', requestId: string): SessionEvent {
    const s = this.session(appSessionId);
    const seq = s.rows.length + 1;
    const fields =
      kind === 'question'
        ? { kind: 'question.requested', requestId, toolUseId: `tu-${requestId}`, questions: [{ question: 'Which way?', options: [{ label: 'left' }, { label: 'right' }] }] }
        : { kind: 'permission.requested', requestId, toolUseId: `tu-${requestId}`, toolName: 'Bash', input: { command: 'git log --oneline' } };
    const event = this.event(s, seq, 0, fields);
    s.rows.push([event]);
    s.requests.set(requestId, event);
    this.batches(appSessionId, [event]);
    this.setItems(appSessionId, [...s.items, item(s, requestId, kind)]);
    return event;
  }

  /** The broker's items replaced, and published (while an app is attached). */
  setItems(appSessionId: string, items: Array<Record<string, unknown>>): void {
    const s = this.session(appSessionId);
    s.items = items;
    this.emit('session.brokerItems', { appSessionId, items });
  }

  setQueue(appSessionId: string, queue: Record<string, unknown>): void {
    const s = this.session(appSessionId);
    s.queue = queue;
    this.emit('session.queue', { appSessionId, ...queue });
  }

  /** Live batches of `events`, cut before each index in `cut`. */
  batches(appSessionId: string, events: SessionEvent[], cut: number[] = []): void {
    let from = 0;
    for (const at of [...cut, events.length]) {
      if (at > from) this.emit('session.eventBatch', { appSessionId, events: events.slice(from, at) });
      from = at;
    }
  }

  /** An event to the endpoint, as mawsd forwards it: only while an app is attached (until O3). */
  emit(name: string, payload: unknown): void {
    if (!this.attached) return;
    for (const listener of this.#events) listener('engine-host', { name, payload });
  }

  attach(attached: boolean): void {
    this.attached = attached;
    for (const listener of this.#attachments) listener(attached);
  }

  /** Answers `name` `host_unavailable` until `heal(name)`. */
  fail(name: string): void {
    this.#failing.add(name);
  }

  heal(name: string): void {
    this.#failing.delete(name);
  }

  /** Holds every answer to `name` until `release(name)`. */
  hold(name: string): void {
    this.#holding.add(name);
  }

  release(name: string): void {
    this.#holding.delete(name);
    for (const go of this.#held.get(name) ?? []) go();
    this.#held.delete(name);
  }

  /** The answer is made when the command arrives; one held (`hold`) reaches the endpoint only at its `release`. */
  async dispatch(owner: string, name: string, input: unknown): Promise<HostResponse> {
    this.calls.push({ name, input });
    if (owner === 'engine-host' && name === 'host.op' && this.#ops !== null) {
      // The runtime checks every input against the registry before a handler sees it.
      const checked = validateCommandInput(name, input);
      return checked.ok ? ok(await this.#ops.op(checked.value as CommandInput<'host.op'>, { client: {} } as HandlerContext)) : no('internal');
    }
    const answer = this.#failing.has(name) ? no('host_unavailable') : this.answer(owner, name, input);
    if (this.#holding.has(name)) await new Promise<void>((resolve) => this.#held.set(name, [...(this.#held.get(name) ?? []), resolve]));
    return answer;
  }

  answer(owner: string, name: string, input: unknown): HostResponse {
    if (owner !== 'engine-host') return no('unknown_command');
    const { appSessionId, afterSeq, limit, requestId } = (input ?? {}) as { appSessionId?: string; afterSeq?: number | null; limit?: number | null; requestId?: string };
    const s = appSessionId === undefined ? undefined : this.sessions.get(appSessionId);
    if (name === 'engine.sessions') return ok([...this.sessions.values()].map((x) => this.status(x)));
    if (s === undefined) return no('internal');
    switch (name) {
      case 'session.status':
        return ok(this.status(s));
      case 'session.events':
        return ok(this.events(s, afterSeq ?? null, limit ?? null));
      case 'session.pendingItems':
        return ok({ items: s.items });
      case 'session.pendingRequest':
        return ok({ event: this.#pending(s, requestId!) });
      case 'session.queue.list':
        return ok(s.queue);
      case 'session.catalog':
        return ok(s.catalog);
      default:
        return no('unknown_command');
    }
  }

  /** A request still listed among the broker's items. */
  #pending(s: HostSession | undefined, requestId: string): SessionEvent | null {
    if (s === undefined || !s.items.some((i) => (i.request as { requestId: string }).requestId === requestId)) return null;
    return s.requests.get(requestId) ?? null;
  }

  /** `session.answer` delivered: the request settles, its item leaving the broker's set. */
  #answer({ appSessionId, requestId }: { appSessionId: string; requestId: string }): { outcome: 'delivered' } {
    const s = this.session(appSessionId);
    this.answered.push(`${appSessionId} ${requestId}`);
    this.setItems(appSessionId, s.items.filter((i) => (i.request as { requestId: string }).requestId !== requestId));
    return { outcome: 'delivered' };
  }

  status(s: HostSession): Record<string, unknown> {
    return { appSessionId: s.appSessionId, launchId: s.launchId, engineSessionId: s.engineSessionId, process: 'ready' };
  }

  /**
   * `session.events` as the engine host answers it: every event after `afterSeq`, whole rows at a time up to about
   * `limit`. From the ring when it holds everything after `afterSeq`; else from the journal; else, the journal lost, from
   * the ring alone with `complete: false`, which may begin inside a row.
   */
  events(s: HostSession, afterSeq: number | null, limit: number | null): { events: SessionEvent[]; lastSeq: number; complete: boolean; historyUnavailable?: true } {
    const all = s.rows.flat();
    const ev = s.evicted;
    const inRing = (e: SessionEvent) => ev === null || e.seq! > ev.seq || (e.seq === ev.seq && Number(e.id.split(':').at(-1)) > ev.idx);
    let source = all.filter(inRing);
    let complete = true;
    let lost = false;
    if (ev !== null && (afterSeq === null || afterSeq < ev.seq)) {
      if (s.journal) source = all;
      else {
        complete = false;
        lost = true;
      }
    }
    let events = source.filter((e) => afterSeq === null || e.seq! > afterSeq);
    if (limit !== null && events.length > limit) {
      let end = limit;
      while (end < events.length && events[end].seq === events[end - 1].seq) end += 1;
      if (end < events.length) {
        events = events.slice(0, end);
        complete = false;
      }
    }
    return { events, lastSeq: events.at(-1)?.seq ?? afterSeq ?? 0, complete, ...(lost ? { historyUnavailable: true as const } : {}) };
  }

  event(s: HostSession, seq: number, i: number, fields: Record<string, unknown>): SessionEvent {
    return { id: `${s.appSessionId}:${s.launchId}:${seq}:${i}`, sessionId: s.engineSessionId ?? 'unknown', at: iso(Date.now()), seq, agentId: null, parentToolUseId: null, ...fields } as unknown as SessionEvent;
  }
}

export function item(s: HostSession, requestId: string, kind: 'question' | 'permission'): Record<string, unknown> {
  return {
    id: `att-${requestId}`,
    appSessionId: s.appSessionId,
    sessionId: s.engineSessionId,
    kind,
    request: { requestId, toolUseId: `tu-${requestId}`, taskId: null, agentId: null },
    summary: kind,
    createdAt: iso(Date.now()),
    state: 'pending',
    stateChangedAt: iso(Date.now()),
    expiresAt: null,
  };
}

// ---- Records the suite holds for lane B -------------------------------------------------------------------------------

export class Records implements RecordSource {
  readonly map = new Map<string, SessionRecord>();
  readonly #listeners = new Set<(target: SessionTarget) => void>();
  #laneA: RecordSource | null = null;

  /** Lane A's records, sminos's members on RL10: bound once the endpoint exists, its changes passed on. */
  bindLaneA(source: RecordSource): void {
    this.#laneA = source;
    source.onChange((target) => this.#tell(target));
  }

  record(target: SessionTarget): SessionRecord | null {
    if (target.lane === 'A') return this.#laneA?.record(target) ?? null;
    return this.map.get(target.session) ?? null;
  }

  onChange(listener: (target: SessionTarget) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(record: SessionRecord, appSessionId = ''): void {
    this.map.set(record.session, record);
    this.#tell({ lane: 'B', session: record.session, appSessionId });
  }

  #tell(target: SessionTarget): void {
    for (const listener of this.#listeners) listener(target);
  }
}

// ---- A started, enrolled endpoint -------------------------------------------------------------------------------------

export type Fixture = {
  /** The org's id, when not the suite's own (ORG). */
  org?: string;
  endpoint: Endpoint;
  services: FakeServices;
  host: FakeEngineHost;
  records: Records;
  ref: string;
  key: SigningKey;
  chain: SignedOrgState[];
  port: () => number;
  interest: Array<[string, string, string[]?]>;
  sminos?: FakeSminos;
};

export type StartOptions = { services?: FakeServices; host?: FakeEngineHost; records?: Records; chain?: SignedOrgState[]; key?: SigningKey; subscriptions?: EndpointOptions['subscriptions'] };

export async function startEndpoint(org: Org, started: Fixture[], options: StartOptions = {}): Promise<Fixture> {
  const host = options.host ?? new FakeEngineHost();
  const services = options.services ?? fakeServices();
  host.serve(services);
  const interest: Fixture['interest'] = [];
  services.interest = { report: (viewer, sessions) => void interest.push(['report', viewer, [...sessions]]), drop: (viewer) => void interest.push(['drop', viewer]) };
  const ref = services.machine.ref;
  const key = options.key ?? (await generateSigningKey(true));
  let chain = options.chain;
  if (chain === undefined) {
    const kid = await keyId(key.pub);
    const s1 = await genesis(ORG, org.A, org.a1, org.recovery);
    const s2 = await successor(s1, [org.a1], (s) => {
      s.members.push({ id: org.B, email: 'b@example.com', role: 'member', devices: [org.b1.device] });
      s.members.push({ id: org.C, email: 'c@example.com', role: 'member', devices: [org.c1.device] });
      s.machines.push({ name: 'mini', ref, pub: key.pub, owners: [org.A] });
      s.machineNames.push({ name: 'mini', ref });
    });
    chain = [s1, s2];
    const state = EndpointState.open(services.machine.stateDir);
    state.setMachineKey({ version: 1, keyId: kid, jwk: (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey, created: iso(Date.now()) });
    state.setLedger({ version: 1, heldKeys: [kid], grants: {}, highWater: {} });
    state.setEnrollment({ version: 1, state: 'org-listed', name: 'mini', ref, org: ORG, hub: HUB, enrollment: 'e'.repeat(32), credentials: { clientId: 'id', clientSecret: 'secret' }, at: iso(Date.now()) });
    state.setOrg({ version: 1, org: ORG, pinned: { roots: s1.state.root.keys, recoveryPub: org.recovery.pub }, head: null, chain: [], hashes: [], certificates: NO_CERTIFICATES, acceptedTransitions: [], highWater: 0 });
    await new EndpointOrg(state, { log: () => {} }).adopt(chain, []);
  }
  let port = 0;
  const listen = (server: Server) =>
    new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((port = (server.address() as AddressInfo).port)));
    });
  let endpoint: Endpoint | null = null;
  const records = options.records ?? new Records();
  endpoint = createEndpoint({
    sleep: (ms) => sleep(Math.min(ms, 50)),
    env: { MAWS_ENDPOINT_DIRECT: '1' },
    direct: { interfaces: () => ({ utun4: [{ address: TAILNET, family: 'IPv4', internal: false, netmask: '255.255.255.255', mac: '00:00:00:00:00:00', cidr: null }] }), listen },
    authorization: { records, checkouts: { known: (path) => endpoint?.rl10.members.known(path) ?? false }, settingsMode: () => 'default' },
    subscriptions: options.subscriptions,
  });
  records.bindLaneA(endpoint.rl10.members);
  await endpoint.start(services);
  const f: Fixture = { endpoint, services, host, records, ref, key, chain, port: () => port, interest };
  started.push(f);
  await until(() => port !== 0, 'the direct listener bound');
  return f;
}

export async function stopAll(started: Fixture[]): Promise<void> {
  for (const f of started.splice(0)) {
    f.sminos?.close();
    await f.endpoint.stop();
    f.services.cleanup();
  }
}

// ---- sminos on RL10 ---------------------------------------------------------------------------------------------------

/** The fake sminos on the endpoint's RL10 socket, welcomed, reporting lane A session `la-1` (owned by `@machine`). */
export async function sminos(f: Fixture, members: Array<Record<string, unknown>> = [laneAMember()]): Promise<FakeSminos> {
  const path = join(f.services.machine.stateDir, 'rl10.json');
  await until(() => fs.existsSync(path), 'rl10.json');
  const info = JSON.parse(fs.readFileSync(path, 'utf8')) as { socket: string; token: string };
  const s = await FakeSminos.open(info.socket);
  s.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'test' }, policy: { read_only: false, ceiling: 'settings' } });
  await s.next((x) => x.t === 'welcome', 'welcome');
  s.send({ t: 'session', message: { project: PROJECT, machine: 'mini', session: null, kind: 'machine', sub: null, n: null, body: { online: true, policy: { read_only: false, ceiling: 'settings' }, checkouts: [{ path: CHECKOUT, branch: 'main' }], desk: {} } } });
  for (const m of members) s.send({ t: 'member', ...m });
  s.send({ t: 'restated' });
  await until(() => members.every((m) => f.endpoint.rl10.members.get(m.session as string) !== null), 'the members');
  f.sminos = s;
  return s;
}

export function laneAMember(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { session: 'la-1', alias: 'main', project: PROJECT, lane: 'A', state: 'idle', title: 'main', cwd: CHECKOUT, launch: 'L1', owners: ['@machine'], ownersProof: [], origin: { kind: 'terminal' }, ...fields };
}

/** A plane message as sminos sends it on RL10. */
export function plane(kind: string, body: unknown, fields: { session?: string | null; sub?: string | null; n?: number | null } = {}): Record<string, unknown> {
  return { t: 'session', message: { project: PROJECT, machine: 'mini', session: fields.session === undefined ? 'la-1' : fields.session, kind, sub: fields.sub ?? null, n: fields.n ?? null, body } };
}

/** sminos's answer to the endpoint's next `subscribe`: its snapshot at n 0 (with the session's last host event). */
export async function serve(s: FakeSminos, session?: string): Promise<Frame> {
  const subscribe = await s.next((x) => x.t === 'subscribe' && (session === undefined || x.session === session), 'an upstream subscribe');
  s.send(plane('snapshot', { rows: [{ uuid: 'r1' }], more: false, subagents: [], presence: { record: null, bridge: true }, streaming: [], host: [{ id: { writer: 'mini/host', seq: 1 }, event: { kind: 'message', text: 'hi' } }] }, { session: subscribe.session as string, sub: subscribe.sub as string, n: 0 }));
  return subscribe;
}

/** sminos's next `n` on an upstream subscription of `session`. */
export function counter(session = 'la-1'): (sub: string, kind: string, body: unknown) => Record<string, unknown> {
  const n = new Map<string, number>();
  return (sub, kind, body) => {
    const next = (n.get(sub) ?? 0) + 1;
    n.set(sub, next);
    return plane(kind, body, { session, sub, n: next });
  };
}

// ---- A device on a channel --------------------------------------------------------------------------------------------

export type Remote = { device: Device; channel: Channel; inbox: ChannelMessage[]; carrier: () => ByteDuplex; member: string };

/** A device's channel to the endpoint: over the direct listener unless `dial` gives another carrier. */
export async function openRemote(f: Fixture, who: TestDevice, member: string, options: { dial?: () => Promise<ByteDuplex>; passkey?: SoftwareAuthenticator } = {}): Promise<Remote> {
  const device = new Device({
    identity: { org: f.org ?? ORG, member, device: who.device.id, clientClass: who.device.class, channelKey: who.channel, build: 'subs', capabilities: [] },
    org: memoryOrgView({ chain: [...f.chain] }),
    ...(who.device.stepUpPub === undefined ? {} : { stepUpKey: who.stepUp }),
    ...(options.passkey === undefined ? {} : { authenticator: options.passkey }),
  });
  const dial = options.dial ?? (() => dialDirect(`ws://127.0.0.1:${f.port()}`));
  let carrier: ByteDuplex | null = null;
  const channel = await device.open(async () => (carrier = await dial()), f.ref);
  const inbox: ChannelMessage[] = [];
  channel.onMessage((m) => void inbox.push(m));
  return { device, channel, inbox, carrier: () => carrier!, member };
}

/** The carrier cut under the channel, with no sealed close (a dropped connection). */
export function drop(r: Remote): void {
  r.carrier().close('dropped');
}

export type Msg = ChannelMessage & Record<string, unknown>;

export const of = (r: Remote, sub: string, from = 0): Msg[] => r.inbox.slice(from).filter((m) => (m as Msg).sub === sub) as Msg[];

export async function waitFor(r: Remote, match: (m: Msg) => boolean, what: string, from = 0, ms = 3000): Promise<Msg> {
  return until(() => r.inbox.slice(from).find((m) => match(m as Msg)) as Msg | undefined, what, ms);
}

export async function subscribe(r: Remote, sub: string, session: { lane: 'A' | 'B'; id: string }, options: { view?: 'full' | 'cards'; cursor?: { epoch: string; seq: number; idx?: number } | null; credit?: number } = {}): Promise<Msg> {
  const from = r.inbox.length;
  await r.channel.send({ t: 'sub', sub, session, ...(options.view === undefined ? {} : { view: options.view }), cursor: options.cursor ?? null, credit: options.credit ?? 4 * 1024 * 1024 });
  return waitFor(r, (m) => m.sub === sub && (m.t === 'subbed' || m.t === 'ended'), `the answer to sub ${sub}`, from);
}

/** A snapshot's pages, from `from`, joined and read (the first complete one). */
export async function snapshot(r: Remote, sub: string, from = 0): Promise<{ epoch: string; seq: number; idx?: number; body: Record<string, unknown> }> {
  return until(() => {
    const pages = of(r, sub, from).filter((m) => m.t === 'snap');
    const last = pages.findIndex((m) => m.last === true);
    if (last < 0) return undefined;
    const mine = pages.slice(0, last + 1);
    const text = mine.map((m) => m.body as string).join('');
    return { epoch: mine[0].epoch as string, seq: mine[0].seq as number, ...(mine[0].idx === undefined ? {} : { idx: mine[0].idx as number }), body: JSON.parse(text) as Record<string, unknown> };
  }, `a snapshot on ${sub}`);
}

/** Every complete snapshot of `sub`, in order, each its pages joined and read. */
export function snapshots(r: Remote, sub: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let text = '';
  for (const m of of(r, sub).filter((x) => x.t === 'snap')) {
    if (m.page === 0) text = '';
    text += m.body as string;
    if (m.last === true) out.push(JSON.parse(text) as Record<string, unknown>);
  }
  return out;
}

/** Every `ev` of `sub` from `from`, as `[epoch, seq, idx]` cursors with their bodies. */
export function evs(r: Remote, sub: string, from = 0): Array<{ epoch: string; seq: number; idx?: number; body: unknown }> {
  return of(r, sub, from)
    .filter((m) => m.t === 'ev')
    .map((m) => ({ epoch: m.epoch as string, seq: m.seq as number, ...(m.idx === undefined ? {} : { idx: m.idx as number }), body: m.body }));
}

/** An event's cursor as its producer numbered it: the id's launch, row and index within the row. */
export function cursorOf(event: SessionEvent): { epoch: string; seq: number; idx: number } {
  const parts = event.id.split(':');
  return { epoch: parts.at(-3)!, seq: Number(parts.at(-2)), idx: Number(parts.at(-1)) };
}

/** An action sent, and its `ack`'s word: `ok` when accepted, else the refusal's reason. */
export async function act(r: Remote, action: Action): Promise<string> {
  const from = r.inbox.length;
  await r.channel.send({ t: 'act', action });
  const m = await waitFor(r, (x) => x.t === 'ack' && x.opId === action.opId, `the ack of ${action.action}`, from);
  return m.state === 'accepted' ? 'ok' : (m.reason as string);
}

/** An accepted action's outcome, from its `done`. */
export async function done(r: Remote, action: Action, from = 0): Promise<unknown> {
  return (await waitFor(r, (x) => x.t === 'done' && x.opId === action.opId, `the done of ${action.action}`, from)).outcome;
}
