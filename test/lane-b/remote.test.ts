// Remote lane B through a real link against a real endpoint (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// M2's "Proves" for this file; acceptance 1's main half and acceptance 5): the endpoint's own harness
// (test/endpoint/sub-harness.ts) on its direct listener at loopback, with its fake engine host and fake spine; O7's
// `createRemoteLink` driven by the profile's real device keys as a device of the machine's owner
// (test/machines/remote-link.test.ts's pattern); and the adapter reached as the router reaches it, `routeLaneB` over the
// manager's path, which here is `dispatchOverLink` on the same link (how the pane's reads reach the machine). The tabs
// are a `main.tabs` value the suite moves.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryOrgView, type ByteDuplex, type SignedOrgState } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { CommandName, CommandResult, EventName } from '@shared/ipc/schema';
import { NO_PROJECT } from '@shared/ipc/schema/layout';
import type { RemoteSession } from '@shared/ipc/schema/remote';
import { validateEventPayload } from '@shared/ipc/validate';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { loadDeviceKeys } from '../../src/main/device/keys';
import { createStepUp } from '../../src/main/device/step-up';
import type { MainContext } from '../../src/main/ipc/router';
import { createRemoteLaneB, ENGINE_HOST_ACTS, MACHINE_ACTS, routeLaneB, type RemoteLaneB, type RemoteLaneBTiming } from '../../src/main/lane-b/remote';
import { dialDirect } from '../../src/main/machines/remote/carriers';
import { dispatchOverLink } from '../../src/main/machines/remote/dispatch';
import { createRemoteLink, type RemoteLink } from '../../src/main/machines/remote/link';
import type { RemoteTiming } from '../../src/main/machines/remote/timing';
import { heldOrgSession, watchedView, type SignedIn } from '../../src/main/org/session';
import { OFFERS } from '../../src/endpoint/offers';
import { endorsed, iso, retiredDevice, successor } from '../endpoint/org-fixtures';
import { CHECKOUT, FakeEngineHost, makeOrg, openRemote, ORG, sleep, startEndpoint, stopAll, until, type Fixture, type HostSession, type Org } from '../endpoint/sub-harness';
import { record, status } from '../support/builders';

// The endpoint's `h2` list, which one case empties: an endpoint of a build before the `machine` executor.
const endpointCaps = vi.hoisted(() => ({ list: ['rl2.executor.machine'] as string[] }));
vi.mock('../../src/endpoint/capabilities', () => ({ ENDPOINT_CAPABILITIES: endpointCaps.list }));

let org: Org;
const started: Fixture[] = [];
const cleanups: Array<() => void> = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  await stopAll(started);
});
afterAll(() => stopAll(started));

const OPEN = { perSource: { burst: 1000, perMinute: 60_000 }, overall: { burst: 1000, perMinute: 60_000 } };
const LOCAL = 'local-machine-ref-0001' as MachineRef;

/**
 * The harness's engine host speaking this build's lane B shapes: a status and events that read as `session.status` and
 * `SessionEvent`s do (the harness's own are only what the endpoint needs), the history of a released session (no host
 * row) that `session.events` answers from its state file, and `host.op`s of a name held before they run.
 */
class LaneBHost extends FakeEngineHost {
  readonly stored = new Map<string, SessionEvent[]>();
  /** Each `host.op` that arrived, by its inner name, held or not. */
  readonly arrived: string[] = [];
  readonly #holding = new Set<string>();
  readonly #held: Array<() => void> = [];

  override status(s: HostSession): Record<string, unknown> {
    return { ...status(s.appSessionId), launchId: s.launchId, engineSessionId: s.engineSessionId, cwd: CHECKOUT };
  }

  override event(s: HostSession, seq: number, i: number, fields: Record<string, unknown>): SessionEvent {
    const kind = fields.kind;
    const read =
      kind === 'note'
        ? { kind: 'notice.posted', level: 'info', text: fields.text, key: null }
        : kind === 'permission.requested'
          ? { displayName: null, description: null, decisionReasonType: null, suggestions: [], blockedPath: null, ...fields }
          : kind === 'question.requested'
            ? { ...fields, questions: [{ question: 'Which way?', header: 'Way', options: [{ label: 'left', description: null, preview: null }, { label: 'right', description: null, preview: null }], multiSelect: false }] }
            : fields;
    return super.event(s, seq, i, read);
  }

  override answer(owner: string, name: string, input: unknown): HostResponse {
    const app = (input as { appSessionId?: string } | null | undefined)?.appSessionId;
    const history = app === undefined || this.sessions.has(app) ? undefined : this.stored.get(app);
    if (name === 'session.events' && history !== undefined) return { t: 'res', id: '0', ok: true, value: { events: history, lastSeq: history.at(-1)?.seq ?? 0, complete: true } };
    return super.answer(owner, name, input);
  }

  override async dispatch(owner: string, name: string, input: unknown, client?: ClientRef): Promise<HostResponse> {
    const inner = name === 'host.op' ? (input as { name: string }).name : null;
    if (inner !== null) {
      this.arrived.push(inner);
      if (this.#holding.has(inner)) await new Promise<void>((resolve) => this.#held.push(resolve));
    }
    return super.dispatch(owner, name, input, client);
  }

  holdOps(name: string): void {
    this.#holding.add(name);
  }

  releaseOps(name: string): void {
    this.#holding.delete(name);
    for (const go of this.#held.splice(0)) go();
  }
}

/** A carrier the test can cut, or mute (its inbound bytes dropped: a lost answer). */
type Tap = { mute: boolean };
function tapped(inner: ByteDuplex, tap: Tap): ByteDuplex {
  return {
    send: (bytes) => inner.send(bytes),
    close: (reason) => inner.close(reason),
    onClose: (listener) => inner.onClose?.(listener),
    onBytes: (listener) => inner.onBytes((bytes) => (tap.mute ? undefined : listener(bytes))),
  };
}

type Emitted = { name: EventName; payload: Record<string, unknown> };
/** One MAWS app: its device keys, its link to the machine and its adapter. */
type Device = {
  id: string;
  mac: Awaited<ReturnType<typeof endorsed>>;
  link: RemoteLink;
  adapter: RemoteLaneB;
  emitted: Emitted[];
  logs: string[];
  carriers: Array<{ carrier: ByteDuplex; tap: Tap }>;
  direct: { dead: boolean };
  tabs(...apps: string[]): void;
  route(name: string, input: unknown): Promise<CommandResult<CommandName>>;
  cmd(name: string, input: unknown): Promise<unknown>;
};
type Lab = { f: Fixture; host: LaneBHost; chain: SignedOrgState[]; a: Device; device(id: string, options?: DeviceOptions): Promise<Device>; place(app: string, engine?: string): void };
type DeviceOptions = { link?: Partial<RemoteTiming>; adapter?: Partial<RemoteLaneBTiming> };

/** The endpoint with the suite's engine host, and device `mac1` of its owner (A) up on it. */
async function lab(options: DeviceOptions = {}): Promise<Lab> {
  const host = new LaneBHost();
  const f = await startEndpoint(org, started, { limits: OPEN, host });
  host.attach(true); // lane B events available (mawsd's permanent link)
  const l = {
    f,
    host,
    chain: [...f.chain],
    device: (id: string, o: DeviceOptions = {}) => device(l, id, o),
    // A session the machine's owners own, its record in the spine's index under `engine`.
    place: (app: string, engine = `eng-${app}`) => {
      f.spine.set(app, engine, { ...record(app, { engineSessionId: engine as never, directory: CHECKOUT }) });
      f.records.set({ lane: 'B', session: engine, owners: ['@machine'] }, app);
    },
  } as Lab;
  l.a = await device(l, 'mac1', options);
  return l;
}

/** A device of A's listed on the machine's head, its link up, its adapter reached through `routeLaneB`. */
async function device(l: Lab, id: string, options: DeviceOptions): Promise<Device> {
  const { f } = l;
  const profile = mkdtempSync(join(tmpdir(), `maws-o7-lane-b-${id}-`));
  cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
  const keys = await loadDeviceKeys(profile, { excludeFromBackup: async () => true });
  const mac = await endorsed(ORG, org.A, { device: { id, class: 'native-mac', keyStorage: 'software', channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub }, channel: keys.channel, stepUp: keys.stepUp }, org.a1);
  const listed = await successor(l.chain.at(-1)!, [org.a1], (st) => void st.members.find((m) => m.id === org.A)!.devices.push(mac.device));
  await deliver(f, [listed]);
  l.chain.push(listed);
  const session = heldOrgSession();
  const signedIn: SignedIn = {
    identity: { org: ORG, member: org.A, device: id, clientClass: 'native-mac', channelKey: keys.channel, build: 'o7-m2', capabilities: [] },
    view: watchedView(memoryOrgView({ chain: [...l.chain] }), () => session.changed()),
    stepUp: createStepUp({ device: { org: ORG, device: id }, key: keys.stepUp, confirm: async () => ({ ok: true }) }),
    hub: null,
  };
  session.set(signedIn);
  const carriers: Device['carriers'] = [];
  const direct = { dead: false };
  const link = createRemoteLink({
    machine: { ref: f.ref as MachineRef, name: 'mini' },
    session,
    records: { resolve: async () => ({ body: { org: ORG, machine: f.ref, addresses: ['ws://100.101.102.108:47830'], issued: iso(Date.now()) }, sig: { kid: 'k', alg: 'ES256', value: 'v' } }) as never },
    // The tailnet address, at the listener's loopback port in its place, while it lives.
    dialDirect: async (_url, timeoutMs) => {
      if (direct.dead) throw new Error('refused');
      const tap: Tap = { mute: false };
      const carrier = tapped(await dialDirect(`ws://127.0.0.1:${f.port()}`, timeoutMs), tap);
      carriers.push({ carrier, tap });
      return carrier;
    },
    openRelay: async () => {
      throw new Error('no hub');
    },
    timing: { DIRECT_BUCKET: OPEN.perSource, ...options.link },
    log: () => {},
  });
  cleanups.push(() => link.close());
  await until(() => link.state() === 'up', `${id}'s link up`, 10_000);

  const machine = f.ref as MachineRef;
  let tabs: unknown = null;
  const layoutListeners = new Set<(key: string) => void>();
  const remoteListeners = new Set<(machines: readonly MachineRef[]) => void>();
  const emitted: Emitted[] = [];
  const logs: string[] = [];
  const adapter = createRemoteLaneB({
    local: LOCAL,
    layout: { get: (key) => (key === 'main.tabs' ? tabs : null), onChange: (listener) => (layoutListeners.add(listener), () => void layoutListeners.delete(listener)) },
    remote: (ref) => (ref === machine ? link : null),
    onRemote: (listener) => (remoteListeners.add(listener), () => void remoteListeners.delete(listener)),
    emit: (to, name, payload) => {
      expect(to).toBe(machine);
      const checked = validateEventPayload(name, payload); // what emitFrom refuses, the suite refuses
      if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
      emitted.push({ name, payload: payload as Record<string, unknown> });
    },
    timing: { idleRetryMs: [50, 400], recordRetryMs: [50, 100], ...options.adapter },
    log: (line) => void logs.push(line),
  });
  cleanups.push(() => adapter.stop());
  const route = routeLaneB((_m, name, input) => dispatchOverLink(link, name, input), (ref) => (ref === machine ? link : null), adapter);
  const ctx: MainContext = { client: endableClientRef(`page-${id}`), target: machine };
  return {
    id,
    mac,
    link,
    adapter,
    emitted,
    logs,
    carriers,
    direct,
    tabs(...apps) {
      const list = apps.map((app) => ({ id: `session:${addressOf(machine, app as AppSessionId)}`, kind: 'session', appSessionId: addressOf(machine, app as AppSessionId), pinned: false }));
      tabs = { version: 3, current: NO_PROJECT, sets: { [NO_PROJECT]: { panes: [{ tabs: list, activeTabId: list[0]?.id ?? '' }], focusedPane: 0, splitRatio: 0.5 } }, closedTabs: [] };
      for (const listener of layoutListeners) listener('main.tabs');
    },
    route: (name, input) => route(machine, name as CommandName, input, ctx),
    async cmd(name, input) {
      const result = await route(machine, name as CommandName, input, ctx);
      if (!result.ok) throw new Error(`${name}: ${result.error.code} ${result.error.message}`);
      return result.value;
    },
  };
}

/** A new head delivered to the endpoint as an admin's device carries it. */
async function deliver(f: Fixture, states: SignedOrgState[]): Promise<void> {
  const admin = await openRemote(f, org.a1, org.A);
  await admin.channel.send({ t: 'state', states, transitions: [] });
  const version = states.at(-1)!.state.version;
  await until(() => (f.endpoint.status().stateVersion ?? 0) >= version, 'the endpoint adopting the head');
  admin.channel.close('closed');
}

const of = (d: Device, name: EventName, app: string) => d.emitted.filter((e) => e.name === name && (e.payload.appSessionId ?? e.payload.address) === app).map((e) => e.payload);
const sessionOf = (d: Device, app: string) => of(d, 'remote.session', app).at(-1) as RemoteSession | undefined;
const eventsOf = (d: Device, app: string) => of(d, 'session.eventBatch', app).flatMap((p) => p.events as SessionEvent[]);
const itemsOf = (d: Device, app: string) => (of(d, 'attention.changed', app).at(-1)?.items as Array<{ request: { requestId: string } }> | undefined) ?? null;
const gapsOf = (d: Device, app: string) => of(d, 'remote.gap', app);
const ids = (events: SessionEvent[]) => events.map((e) => e.id);

/** The tab open and its stream live on the session's launch. */
async function opened(d: Device, app: string, launch: string): Promise<void> {
  d.tabs(app);
  await until(() => sessionOf(d, app)?.stream === 'live' && of(d, 'session.status', app).some((p) => (p.status as { launchId: string }).launchId === launch), `${app} live on ${d.id}`, 5000);
}

describe('remote lane B over a real link', { timeout: 30_000 }, () => {
  it('builds only acts the endpoint offers, each as the act its row names', () => {
    for (const name of ENGINE_HOST_ACTS) expect([name, OFFERS.commands[name]]).toMatchObject([name, { kind: 'act', executor: 'engine-host' }]);
    for (const name of MACHINE_ACTS) expect([name, OFFERS.commands[name]]).toMatchObject([name, { kind: 'act', executor: 'machine' }]);
    // The substitutes' reads, as calls.
    for (const name of ['session.pendingRequest', 'session.listModels']) expect([name, OFFERS.commands[name]]).toMatchObject([name, { kind: 'call' }]);
  });

  it('opens a session from its tab: the record and the stream from the launch’s first event, each event at the host’s cursor, then live; the pane’s reads through the manager’s path', async () => {
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    const before = [...l.host.row('app-1', 3), ...l.host.row('app-1', 1)];
    await opened(l.a, 'app-1', s.launchId);
    expect(l.a.emitted.find((e) => e.name === 'session.changed')!.payload).toMatchObject({ record: { appId: 'app-1', engineSessionId: 'eng-app-1' }, cause: 'live' });
    expect(sessionOf(l.a, 'app-1')).toMatchObject({ link: { state: 'up', carrier: 'direct', refusal: null, member: org.A }, stream: 'live', reason: null, controls: { send: { available: true } } });
    await until(() => eventsOf(l.a, 'app-1').length === 4, 'the launch’s events');
    // A live row cut into two batches by the host.
    const live = l.host.row('app-1', 3, { cut: [1] });
    await until(() => eventsOf(l.a, 'app-1').length === 7, 'the live row');
    expect(ids(eventsOf(l.a, 'app-1'))).toEqual(ids([...before, ...live]));
    expect(gapsOf(l.a, 'app-1')).toEqual([]);

    // The pane's reads, which the adapter leaves to the manager's path: on the same link, as calls.
    expect(await l.a.cmd('session.get', { appSessionId: 'app-1' })).toMatchObject({ appId: 'app-1', directory: CHECKOUT });
    expect(await l.a.cmd('session.status', { appSessionId: 'app-1' })).toMatchObject({ launchId: s.launchId, engineSessionId: 'eng-app-1' });
    expect(ids(((await l.a.cmd('session.events', { appSessionId: 'app-1', afterSeq: null, limit: 100 })) as { events: SessionEvent[] }).events)).toEqual(ids([...before, ...live]));
  });

  it('opens a released session (a record, no host row): its history read, its stream idle and retried, then resumed by a send’s acquire and streaming the new launch', async () => {
    const l = await lab();
    const old = l.host.add('app-r', 'eng-r');
    const history = l.host.row('app-r', 2, { live: false });
    l.host.stored.set('app-r', history);
    l.host.sessions.delete('app-r'); // released as idle: the state file stays, the host row goes
    l.place('app-r', 'eng-r');
    l.a.tabs('app-r');
    await until(() => sessionOf(l.a, 'app-r')?.stream === 'idle', 'the stream ended unavailable: not live');
    const statusReads = () => l.host.calls.filter((c) => c.name === 'session.status' && (c.input as { appSessionId: string }).appSessionId === 'app-r').length;
    const first = statusReads();
    await until(() => statusReads() >= first + 2, 'the subscription retried on the backoff');
    expect(sessionOf(l.a, 'app-r')).toMatchObject({ stream: 'idle', reason: null, controls: { send: { available: true } } });
    expect(ids(((await l.a.cmd('session.events', { appSessionId: 'app-r', afterSeq: null, limit: 100 })) as { events: SessionEvent[] }).events)).toEqual(ids(history));

    // A send resumes it first (`session.acquire`, a `machine` act), then is sealed with the new launch's first status.
    expect(await l.a.cmd('session.send', { appSessionId: 'app-r', content: 'wake up' })).toEqual({ messageUuid: null, disposition: 'queued', queueId: 'q1' });
    expect(l.f.spine.acquired).toEqual(['app-r']);
    const resumed = l.host.session('app-r').launchId;
    expect(resumed).not.toBe(old.launchId);
    expect(l.host.runs).toEqual([{ appSessionId: 'app-r', content: 'wake up', launchId: resumed }]);
    expect(sessionOf(l.a, 'app-r')?.stream).toBe('live');
    // The send's row streams on the new launch.
    await until(() => eventsOf(l.a, 'app-r').some((e) => e.id.startsWith(`app-r:${resumed}:1:`)), 'the new launch’s first row');
  });

  it('runs a send once across a forced drop, answering only at its outcome', async () => {
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    l.a.carriers.at(-1)!.tap.mute = true; // nothing the endpoint says reaches the link: no ack, no done
    let answered = false;
    const sending = l.a.cmd('session.send', { appSessionId: 'app-1', content: 'once' }).finally(() => (answered = true));
    await until(() => l.host.runs.length === 1, 'the send run on the host');
    await sleep(200);
    expect(answered).toBe(false);
    l.a.carriers.at(-1)!.carrier.close('dropped');
    expect(await sending).toEqual({ messageUuid: null, disposition: 'queued', queueId: 'q1' });
    expect(l.host.runs).toHaveLength(1);
  });

  it('answers a send made during a drop longer than the hold `host_unavailable` in A4’s words, with nothing run', async () => {
    const l = await lab({ link: { ACT_FRESH_MS: 400, UP_GRACE_MS: 100 } });
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    l.a.direct.dead = true;
    l.a.carriers.at(-1)!.carrier.close('dropped');
    await until(() => l.a.link.state() !== 'up', 'the link off its channel');
    expect(await l.a.route('session.send', { appSessionId: 'app-1', content: 'while away' })).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: 'Not sent: mini is offline' } });
    expect(l.host.runs).toEqual([]);
  });

  it('answers a send the channel carried and lost `timeout` in the pending words at the bound, while the link’s query settles it later', async () => {
    const l = await lab({ adapter: { sendPendingMs: 500 } });
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    l.a.carriers.at(-1)!.tap.mute = true;
    const sending = l.a.route('session.send', { appSessionId: 'app-1', content: 'carried' });
    await until(() => l.host.runs.length === 1, 'the send run on the host');
    l.a.direct.dead = true;
    l.a.carriers.at(-1)!.carrier.close('dropped');
    expect(await sending).toMatchObject({ ok: false, error: { code: 'timeout', message: 'mini took the message but hasn’t confirmed it; check the transcript' } });
    l.a.direct.dead = false;
    l.a.link.probe('network');
    await until(() => l.a.logs.find((line) => line.includes('session.send') && line.includes('settled late: done')), 'the late outcome logged', 15_000);
    expect(l.host.runs).toHaveLength(1);
  });

  it('answers a request with DX6’s digest over the pending request, which the host checks', async () => {
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    const request = l.host.request('app-1', 'permission', 'req-1');
    await until(() => itemsOf(l.a, 'app-1')?.length === 1, 'the request among the pending items');
    const allow = { appSessionId: 'app-1', requestId: 'req-1', answer: { kind: 'permission', decision: 'allow', scope: 'once' } };

    // The request the adapter read changes on the host before the answer arrives: the digest no longer matches.
    l.host.hold('session.pendingRequest');
    const stale = l.a.route('session.answer', allow);
    await until(() => l.host.calls.some((c) => c.name === 'session.pendingRequest'), 'the pending request read');
    s.requests.set('req-1', { ...request, input: { command: 'rm -rf ~' } } as SessionEvent);
    l.host.release('session.pendingRequest');
    expect(await stale).toMatchObject({ ok: false, error: { issues: { refusal: 'digest-mismatch' } } });
    expect(l.host.answered).toEqual([]);

    s.requests.set('req-1', request);
    expect(await l.a.cmd('session.answer', allow)).toEqual({ outcome: 'delivered' });
    expect(l.host.answered).toEqual(['app-1 req-1']);
    await until(() => itemsOf(l.a, 'app-1')?.length === 0, 'the item settled');
    // Not pending any more: answered here, no act.
    const ops = l.host.arrived.length;
    expect(await l.a.cmd('session.answer', allow)).toEqual({ outcome: 'not_pending' });
    expect(l.host.arrived).toHaveLength(ops);
  });

  it('sends one at a time and never holds an interrupt behind them', async () => {
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    l.host.handlers.set('session.interrupt', () => ({ stillQueued: [], cancelled: [] }));
    l.host.holdOps('session.send');
    const first = l.a.cmd('session.send', { appSessionId: 'app-1', content: 'one' });
    const second = l.a.cmd('session.send', { appSessionId: 'app-1', content: 'two' });
    await until(() => l.host.arrived.includes('session.send'), 'the first send at the host, held');
    expect(await l.a.cmd('session.interrupt', { appSessionId: 'app-1', cancelEngineQueued: false })).toEqual({ stillQueued: [], cancelled: [] });
    expect(l.host.arrived).toEqual(['session.send', 'session.interrupt']); // the second send not yet made
    expect(l.host.runs).toEqual([]);
    l.host.releaseOps('session.send');
    await Promise.all([first, second]);
    expect(l.host.runs.map((r) => r.content)).toEqual(['one', 'two']);
  });

  it('carries a 2 MiB image inline and refuses a 4 MiB one locally', async () => {
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    const image = (bytes: number) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.alloc(bytes, 7).toString('base64') } });
    const fits = [{ type: 'text', text: 'look' }, image(2 * 1024 * 1024)];
    expect(await l.a.cmd('session.send', { appSessionId: 'app-1', content: fits })).toMatchObject({ disposition: 'queued' });
    expect(l.host.runs.map((r) => r.content)).toEqual([fits]);
    const ops = l.host.arrived.length;
    expect(await l.a.route('session.send', { appSessionId: 'app-1', content: [image(4 * 1024 * 1024)] })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input', message: 'an image larger than 2.5 MiB goes to a session on another machine as a file' },
    });
    expect(l.host.arrived).toHaveLength(ops);
  });

  it('refuses `session.acquire` locally `not-offered` against an endpoint that lists no `rl2.executor.machine`', async () => {
    endpointCaps.list.splice(0);
    cleanups.push(() => void endpointCaps.list.splice(0, Infinity, 'rl2.executor.machine'));
    const l = await lab();
    l.place('app-r', 'eng-r');
    expect(l.a.link.peerCapabilities()).toEqual([]);
    expect(await l.a.route('session.acquire', { appSessionId: 'app-r', reason: 'send' })).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'not-offered' } } });
    expect(l.f.spine.acquired).toEqual([]);
    expect(l.host.calls.filter((c) => c.name === 'machine.op')).toEqual([]);
  });

  it('says one `remote.gap` for a relaunch’s snapshot and one for a lost range’s `missing`', async () => {
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    l.host.row('app-1', 2);
    await opened(l.a, 'app-1', s.launchId);
    const first = s.launchId;
    await until(() => eventsOf(l.a, 'app-1').length === 2, 'the first launch’s events');

    l.host.relaunch('app-1');
    await until(() => gapsOf(l.a, 'app-1').length === 1, 'the relaunch’s gap');
    expect(gapsOf(l.a, 'app-1')).toEqual([{ appSessionId: 'app-1', launchId: s.launchId }]);
    expect(s.launchId).not.toBe(first);
    const row = l.host.row('app-1', 1);
    await until(() => eventsOf(l.a, 'app-1').some((e) => e.id === row[0].id), 'the new launch’s row');
    expect(sessionOf(l.a, 'app-1')?.stream).toBe('live');

    // Two rows the stream never saw, the first gone from the host's ring with no journal to read it back from.
    l.host.row('app-1', 1, { live: false });
    const kept = l.host.row('app-1', 1, { live: false });
    s.evicted = { seq: 2, idx: 0 };
    s.journal = false;
    l.host.upstream(false);
    l.host.upstream(true); // each stream catches up from its cursor
    await until(() => gapsOf(l.a, 'app-1').length === 2, 'the lost range’s gap');
    expect(gapsOf(l.a, 'app-1')[1]).toEqual({ appSessionId: 'app-1', launchId: s.launchId });
    await until(() => eventsOf(l.a, 'app-1').some((e) => e.id === kept[0].id), 'what the ring kept');
    await sleep(200);
    expect(gapsOf(l.a, 'app-1')).toHaveLength(2);
  });

  it('settles one device’s pending item when another device answers it (acceptance 5)', async () => {
    const l = await lab();
    const b = await l.device('mac2');
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    await opened(b, 'app-1', s.launchId);
    l.host.request('app-1', 'question', 'req-q');
    await until(() => itemsOf(l.a, 'app-1')?.length === 1 && itemsOf(b, 'app-1')?.length === 1, 'the question pending on both');
    expect(await b.cmd('session.answer', { appSessionId: 'app-1', requestId: 'req-q', answer: { kind: 'question', answers: { 'Which way?': 'left' } } })).toEqual({ outcome: 'delivered' });
    await until(() => itemsOf(l.a, 'app-1')?.length === 0, 'the item settled on the other device');
    expect(l.host.answered).toEqual(['app-1 req-q']);
  });

  it('ends the stream and greys every control when a new head drops the device (`removed`)', async () => {
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    const dropped = await successor(l.chain.at(-1)!, [org.a1], async (st) => {
      const a = st.members.find((m) => m.id === org.A)!;
      a.devices = a.devices.filter((d) => d.id !== 'mac1');
      st.retired.push(...(await retiredDevice(org.A, l.a.mac.device, st.issued)));
    });
    await deliver(l.f, [dropped]);
    await until(() => sessionOf(l.a, 'app-1')?.stream === 'ended', 'the stream ended');
    const ended = sessionOf(l.a, 'app-1')!;
    expect(ended).toMatchObject({ link: { refusal: 'removed' }, reason: 'This Mac is no longer allowed on mini' });
    expect(Object.values(ended.controls).every((c) => !c.available)).toBe(true);
    expect(l.a.link.refusal()).toBe('removed');
  });

  it('closes a session’s subscription once its tab is gone past the linger', async () => {
    const l = await lab({ adapter: { unsubscribeLingerMs: 200 } });
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    const report = await until(() => l.f.interest.find((x) => x[0] === 'report' && x[2]?.includes('app-1')), 'the endpoint counting the viewer');
    const dropped = () => l.f.interest.some((x) => x[0] === 'drop' && x[1] === report[1]);
    l.a.tabs();
    await sleep(50);
    expect(dropped()).toBe(false); // the linger
    await until(dropped, 'the subscription closed past the linger', 3000);
  });
});
