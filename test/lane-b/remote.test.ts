// Remote lane B through a real link against a real endpoint (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// M2's "Proves" for this file; acceptance 1's main half and acceptance 5): the endpoint's own harness
// (test/endpoint/sub-harness.ts) on its direct listener at loopback, with its fake engine host and fake spine; O7's
// `createRemoteLink` driven by the profile's real device keys as a device of the machine's owner
// (test/machines/remote-link.test.ts's pattern); and the adapter reached as the router reaches it, `routeLaneB` over the
// manager's path, which here is `dispatchOverLink` on the same link (how the pane's reads reach the machine). The tabs
// are a `main.tabs` value the suite moves.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { keyId, memoryOrgView, signRecord, SIGNING_DOMAINS, type Action, type ByteDuplex, type Grant, type SignedOrgState } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { endableClientRef, type ClientRef, type HandlerOp } from '@shared/ipc/client';
import type { FilesListOutput, FilesReadOutput, FilesUploadInput, FilesUploadOutput } from '@shared/ipc/schema/files';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { CommandName, CommandResult, EventName } from '@shared/ipc/schema';
import { NO_PROJECT } from '@shared/ipc/schema/layout';
import type { RemoteSession } from '@shared/ipc/schema/remote';
import { validateEventPayload } from '@shared/ipc/validate';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { loadDeviceKeys } from '../../src/main/device/keys';
import { createStepUp } from '../../src/main/device/step-up';
import { harnessConfirmation } from '../../src/main/device/step-up-sheet';
import { DEVICE_CAPABILITIES } from '../../src/main/machines/remote/capabilities';
import type { MainContext } from '../../src/main/ipc/router';
import { createRemoteLaneB, ENGINE_HOST_ACTS, MACHINE_ACTS, routeLaneB, type RemoteLaneB, type RemoteLaneBTiming } from '../../src/main/lane-b/remote';
import { dialDirect } from '../../src/main/machines/remote/carriers';
import { dispatchOverLink } from '../../src/main/machines/remote/dispatch';
import { createRemoteLink, type RemoteLink } from '../../src/main/machines/remote/link';
import type { RemoteTiming } from '../../src/main/machines/remote/timing';
import { heldOrgSession, watchedView, type SignedIn } from '../../src/main/org/session';
import { OFFERS } from '../../src/endpoint/offers';
import { registerFilesHandlers, type FilesHandlers } from '../../src/services/files/register';
import { createUpload } from '../../src/services/files/upload';
import { registerGitHandlers } from '../../src/services/git/register';
import { createGitRunner } from '../../src/services/git/runner';
import { GitService } from '../../src/services/git/service';
import { GitFixture } from '../support/git-fixture';
import { endorsed, iso, retiredDevice, successor } from '../endpoint/org-fixtures';
import { CHECKOUT, FakeEngineHost, makeOrg, openRemote, ORG, sleep, sminos, startEndpoint, stopAll, until, type Fixture, type HostSession, type Org } from '../endpoint/sub-harness';
import { record, status } from '../support/builders';
import { DaemonClocks } from '../../src/mawsd/clocks';
import { engineRequests } from '../../src/mawsd/engine-requests';

// The endpoint's `h2` list, the build's own by default, which a case narrows to an endpoint of an earlier build (before the
// `machine` executor, before M4's byte budget); each case starts from the whole list again.
const endpointCaps = vi.hoisted(() => ({ list: [] as string[], full: [] as string[] }));
vi.mock('../../src/endpoint/capabilities', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/endpoint/capabilities')>();
  endpointCaps.full = [...real.ENDPOINT_CAPABILITIES];
  endpointCaps.list.splice(0, Infinity, ...endpointCaps.full);
  return { ENDPOINT_CAPABILITIES: endpointCaps.list };
});
/** This case's endpoint lists none of `dropped`. */
function endpointWithout(...dropped: string[]): void {
  endpointCaps.list.splice(0, Infinity, ...endpointCaps.full.filter((c) => !dropped.includes(c)));
  cleanups.push(() => void endpointCaps.list.splice(0, Infinity, ...endpointCaps.full));
}

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
  /** Sessions whose launch ended with the host's row kept (`ProcessTable`'s exited rows): their status says `exited`. */
  readonly exited = new Set<string>();
  /** Each `host.op` that arrived, by its inner name, held or not. */
  readonly arrived: string[] = [];
  readonly #holding = new Set<string>();
  readonly #held: Array<() => void> = [];

  override status(s: HostSession): Record<string, unknown> {
    const ended = this.exited.has(s.appSessionId) ? { process: 'exited', exit: { code: 0, signal: null, reason: 'stop', at: iso(Date.now()), release: null } } : {};
    return { ...status(s.appSessionId), launchId: s.launchId, engineSessionId: s.engineSessionId, cwd: CHECKOUT, ...ended };
  }

  /** The launch ended, its row kept: the status says `exited`, as the engine host publishes it. */
  exit(appSessionId: string): void {
    this.exited.add(appSessionId);
    this.emit('session.status', { appSessionId, status: this.status(this.session(appSessionId)) });
  }

  override relaunch(appSessionId: string): HostSession {
    this.exited.delete(appSessionId);
    return super.relaunch(appSessionId);
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
    const fields = (input ?? {}) as { appSessionId?: string; afterSeq?: number | null; limit?: number | null; before?: string; maxBytes?: number };
    const app = fields.appSessionId;
    const history = app === undefined || this.sessions.has(app) ? undefined : this.stored.get(app);
    if (name === 'session.events' && history !== undefined) return { t: 'res', id: '0', ok: true, value: diskWindow(history, fields.before, fields.limit ?? null, fields.maxBytes) };
    // P5 O7 M4: a live launch's page within a byte budget, as the engine host's stream answers one
    if (name === 'session.events' && app !== undefined && fields.maxBytes !== undefined) return { t: 'res', id: '0', ok: true, value: livePage(this.session(app).rows, fields.afterSeq ?? null, fields.maxBytes) };
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

const utf8 = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/**
 * A released session's history as the engine host reads it from the transcript: without a budget the whole window
 * before `before` (the default window keeps whole turns, past any channel), or with `limit` N its first N events; within
 * one (P5 O7 M4) the newest events before `before` that fit with the answer's envelope, `earlier` reaching the rest, an
 * event alone past it left out.
 */
function diskWindow(history: SessionEvent[], before: string | undefined, limit: number | null, maxBytes: number | undefined): Record<string, unknown> {
  const end = before === undefined ? history.length : history.findIndex((e) => e.id === before);
  if (maxBytes === undefined && before === undefined && limit !== null) return { events: history.slice(0, limit), lastSeq: 0, complete: true };
  if (maxBytes === undefined) return { events: history.slice(0, end), lastSeq: history.at(-1)?.seq ?? 0, complete: true };
  let start = end;
  let bytes = 1024; // the envelope and the cursor
  while (start > 0) {
    const next = utf8(history[start - 1]) + 1;
    if (bytes + next > maxBytes) break;
    bytes += next;
    start -= 1;
  }
  if (start === end && end > 0) return { events: [], lastSeq: 0, complete: true, earlier: history[end - 1].id, omitted: { events: 1, bytes: utf8(history[end - 1]), seq: null } };
  return { events: history.slice(start, end), lastSeq: 0, complete: true, ...(start > 0 && { earlier: history[start].id }) };
}

/** A live launch's events after `afterSeq` within `maxBytes`: whole rows while they fit, a row alone past it left out. */
function livePage(rows: SessionEvent[][], afterSeq: number | null, maxBytes: number): Record<string, unknown> {
  const after = rows.filter((row) => row.length > 0 && (afterSeq === null || row[0].seq! > afterSeq));
  const events: SessionEvent[] = [];
  let bytes = 256;
  for (const row of after) {
    if (bytes + utf8(row) > maxBytes) {
      if (events.length > 0) return { events, lastSeq: events.at(-1)!.seq, complete: false };
      return { events: [], lastSeq: row[0].seq, complete: false, omitted: { events: row.length, bytes: utf8(row), seq: row[0].seq } };
    }
    bytes += utf8(row);
    events.push(...row);
  }
  return { events, lastSeq: events.at(-1)?.seq ?? afterSeq ?? 0, complete: true };
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
  /** What step-up was asked to confirm, by summary. */
  confirmed: string[];
  tabs(...apps: string[]): void;
  /** `from`: the page and the session a path-class command is made from (MainContext's `client` and `session`). */
  route(name: string, input: unknown, from?: Partial<MainContext>): Promise<CommandResult<CommandName>>;
  cmd(name: string, input: unknown, from?: Partial<MainContext>): Promise<unknown>;
};
type Lab = { f: Fixture; host: LaneBHost; chain: SignedOrgState[]; a: Device; device(id: string, options?: DeviceOptions): Promise<Device>; place(app: string, engine?: string, fields?: Record<string, unknown>): void };
/** `member`: whose device it is (A, the machine's owner, by default; B, a member who owns nothing there). */
type DeviceOptions = { link?: Partial<RemoteTiming>; adapter?: Partial<RemoteLaneBTiming>; member?: 'A' | 'B' };

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
    place: (app: string, engine = `eng-${app}`, fields: Record<string, unknown> = {}) => {
      f.spine.set(app, engine, { ...record(app, { engineSessionId: engine as never, directory: CHECKOUT, ...fields }) });
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
  const [member, by] = options.member === 'B' ? [org.B, org.b1] : [org.A, org.a1];
  const mac = await endorsed(ORG, member, { device: { id, class: 'native-mac', keyStorage: 'software', channelPub: keys.channel.pub, stepUpPub: keys.stepUp.pub }, channel: keys.channel, stepUp: keys.stepUp }, by);
  const listed = await successor(l.chain.at(-1)!, [org.a1], (st) => void st.members.find((m) => m.id === member)!.devices.push(mac.device));
  await deliver(f, [listed]);
  l.chain.push(listed);
  const session = heldOrgSession();
  const confirmed: string[] = [];
  const signedIn: SignedIn = {
    identity: { org: ORG, member, device: id, clientClass: 'native-mac', channelKey: keys.channel, build: 'o7-m4', capabilities: [...DEVICE_CAPABILITIES] },
    view: watchedView(memoryOrgView({ chain: [...l.chain] }), () => session.changed()),
    // the harness's confirmation in place of the sheet and Touch ID (§P), the signature and its check real
    stepUp: createStepUp({ device: { org: ORG, device: id }, key: keys.stepUp, confirm: (prompt) => (confirmed.push(prompt.summary), harnessConfirmation({ MAWS_E2E: '1', MAWS_E2E_STEP_UP: 'accept' }, false)!(prompt)) }),
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
  // The manager's path, as the RL2 link's `dispatch` takes it: the session a path-class read was made from as `call.session`
  const route = routeLaneB((_m, name, input, c) => dispatchOverLink(link, name, input, c.session), (ref) => (ref === machine ? link : null), adapter);
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
    confirmed,
    route: (name, input, from) => route(machine, name as CommandName, input, { ...ctx, ...from }),
    async cmd(name, input, from) {
      const result = await route(machine, name as CommandName, input, { ...ctx, ...from });
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

const MiB = 1024 * 1024;
type Events = { events: SessionEvent[]; lastSeq: number; complete: boolean; earlier?: string; historyUnavailable?: true; omitted?: unknown };
const repos: GitFixture[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.dispose();
});

/** A git repository on this machine, standing in for the remote machine's checkout. */
async function gitRepo(): Promise<GitFixture> {
  const repo = await GitFixture.create();
  repos.push(repo);
  return repo;
}

/**
 * The machine's real checkout services behind the endpoint's spine (P5 O7 M4): files (with uploads) over each session's
 * record in the spine's index, and git, their changes the machine's own events, which the checkout feed carries.
 */
function checkoutServices(l: Lab, repo: GitFixture): FilesHandlers {
  const { f } = l;
  const recordOf = (id: string) => (f.spine.records.get(id) as SessionRecord | undefined) ?? null;
  const upload = createUpload({ sessions: { record: recordOf, intent: () => null } as never, roots: { record: () => {}, sweep: () => 0 }, git: createGitRunner({ env: repo.serviceEnv() }), log: () => {} });
  registerGitHandlers(new GitService({ env: repo.serviceEnv(), emit: (change) => f.host.emitMachine('git.changed', change) }), f.spine.bus as never);
  const files = registerFilesHandlers((id) => recordOf(id), {
    bus: f.spine.bus as never,
    emit: (payload) => f.host.emitMachine('files.changed', payload),
    port: { openExternal: async () => ({ opened: false, message: null }), reveal: async () => ({ revealed: false }) } as never,
    env: repo.serviceEnv(),
    upload,
  });
  cleanups.push(() => files.dispose());
  return files;
}

/** A grant of `spawn` on the machine to `member`, signed by its admin (A). */
async function grantSpawn(f: Fixture, member: string): Promise<string> {
  const body: Grant = { org: ORG, machine: f.ref, machineKey: await keyId(f.key.pub), member, rights: ['spawn'], version: 1, issued: iso(Date.now()) };
  return (await f.endpoint.cli('grant', ['-'], JSON.stringify(await signRecord(SIGNING_DOMAINS.grant, body, org.a1.stepUp.privateKey, org.a1.stepUp.pub)))).out;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const gitChanges = (d: Device) => d.emitted.filter((e) => e.name === 'git.changed').map((e) => e.payload as { repoRoot: string; status: GitStatus; reason: string });
const filesChanges = (d: Device, app: string) => of(d, 'files.changed', app) as Array<{ path: string; kind: string }>;

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

  it('opens a released session (a record, no host row): its history read, its stream idle, then resumed by a send’s acquire and streaming the new launch', async () => {
    const l = await lab();
    const old = l.host.add('app-r', 'eng-r');
    const history = l.host.row('app-r', 2, { live: false });
    l.host.stored.set('app-r', history);
    l.host.sessions.delete('app-r'); // released as idle: the state file stays, the host row goes
    l.place('app-r', 'eng-r');
    l.a.tabs('app-r');
    await until(() => sessionOf(l.a, 'app-r')?.stream === 'idle', 'the stream ended unavailable: not live');
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

  // O5's landing audit: a try of an idle stream places the session on the engine host (`session.status`, which wakes a
  // parked one) and reports interest, which restarts the park clock; with the checkout feed carrying the record, an open
  // tab tries only when the record says the session runs. The adapter's backoff here is 50 ms doubling to 400 ms, so a
  // blind retry would show several times over the wait.
  it('keeps an open tab on a session that isn’t live from placing it or reporting interest again, so the machine’s host parks, and picks it up once the machine says it runs', async () => {
    const l = await lab();
    // mawsd's park clock over the endpoint's seams, as daemon.ts wires them: every engine-host request goes through
    // engineRequests (a park need), and the viewers' union is the interest. The park window here is 1.5 s.
    const parks: number[] = [];
    const clocks = new DaemonClocks('unit', { armEnginePark: () => (parks.push(Date.now()), true), disarmEnginePark: () => {}, exitDaemon: () => {}, quiet: () => {} });
    cleanups.push(() => clocks.stop());
    const needs = vi.spyOn(clocks, 'engineNeeded');
    const flips = vi.spyOn(clocks, 'interest');
    clocks.configure(1500);
    clocks.served();
    clocks.engineHost(4242);
    const services = l.f.services;
    const dispatch = services.dispatch.bind(services);
    const requests = engineRequests({ hosts: { forward: (owner, { name, input }) => dispatch(owner, name, input), onState: () => () => {}, parked: () => parks.length > 0 }, clocks, log: () => {} });
    services.dispatch = (owner, name, input, client) => (owner === 'engine-host' ? requests.forward(owner, { name, input }) : dispatch(owner, name, input, client));
    const views = new Map<string, readonly string[]>();
    const seam = services.interest;
    services.interest = {
      report: (viewer, sessions) => (seam.report(viewer, sessions), views.set(viewer, sessions), clocks.interest([...views.values()].every((s) => s.length === 0))),
      drop: (viewer) => (seam.drop(viewer), views.delete(viewer), clocks.interest([...views.values()].every((s) => s.length === 0))),
    };

    l.host.stored.set('app-r', []);
    l.place('app-r', 'eng-r'); // a record and no host row: released as idle, or the host parked since
    l.a.tabs('app-r');
    await until(() => sessionOf(l.a, 'app-r')?.stream === 'idle', 'the stream ended unavailable: not live');
    // The checkout feed opens beside the first try; its opening is said to the session, one more try at most.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const placements = () => l.host.calls.filter((c) => c.name === 'session.status' && (c.input as { appSessionId: string }).appSessionId === 'app-r').length;
    const [placed, interest, needed, flipped, settled] = [placements(), l.f.interest.length, needs.mock.calls.length, flips.mock.calls.length, Date.now()];
    expect(needed).toBeGreaterThan(0); // the opening needed the engine host
    await until(() => parks.length > 0, 'the machine’s engine host asked to park', 3000);
    expect(parks[0] - settled).toBeLessThan(1500 + 500); // within the window from the opening's last need
    await new Promise((resolve) => setTimeout(resolve, 1000)); // and nothing after it
    expect(needs.mock.calls.length).toBe(needed);
    expect(flips.mock.calls.length).toBe(flipped);
    expect(placements()).toBe(placed);
    expect(l.f.interest).toHaveLength(interest);
    expect(sessionOf(l.a, 'app-r')).toMatchObject({ stream: 'idle', reason: null });
    clocks.hosts({ engine: true, pty: true }); // it parked

    // Someone else runs it (a send from another device, the machine's own app): its record's holder becomes `self`.
    const run = l.host.add('app-r', 'eng-r');
    const started = Date.now();
    l.f.host.emitMachine('session.changed', { record: { ...record('app-r', { engineSessionId: 'eng-r' as never, directory: CHECKOUT }), holder: { kind: 'self' } }, cause: 'live', revision: 2 });
    await opened(l.a, 'app-r', run.launchId);
    expect(Date.now() - started).toBeLessThan(2000);
    const row = l.host.row('app-r', 1);
    await until(() => eventsOf(l.a, 'app-r').some((e) => e.id === row[0].id), 'the new launch’s row');
  });

  // Fix wave 1 (finding 1): the budget is the current channel's peer's to take, page by page.
  it('goes on with a budgeted hydration on M2’s path when the channel drops and the next one’s endpoint lists no budget', async () => {
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    const small = l.host.row('app-1', 2);
    await opened(l.a, 'app-1', s.launchId);
    const big = (bytes: number) => {
      const row = [l.host.event(s, s.rows.length + 1, 0, { kind: 'note', text: 'x'.repeat(bytes) })];
      s.rows.push(row);
      return row;
    };
    const fits = [big(1.5 * MiB), big(1.5 * MiB), big(1.5 * MiB)];
    const huge = big(5 * MiB);
    // The first budgeted page is answered by the engine host, then lost with its channel; the endpoint the device
    // reaches next (an older build, say) lists no budget.
    const opening = l.host.calls.length;
    let cut = 0;
    const answer = l.host.answer.bind(l.host);
    l.host.answer = (owner, name, input) => {
      if (name === 'session.events' && (input as { maxBytes?: number }).maxBytes !== undefined && cut++ === 0) {
        endpointWithout('rl2.events-budget');
        const { carrier, tap } = l.a.carriers.at(-1)!;
        tap.mute = true;
        setTimeout(() => carrier.close('dropped'), 20);
      }
      return answer(owner, name, input);
    };
    const read = (await l.a.cmd('session.events', { appSessionId: 'app-1', afterSeq: null, limit: null })) as Events;
    expect(cut).toBeGreaterThan(0);
    expect(l.a.carriers.length).toBeGreaterThan(1);
    expect(ids(read.events)).toEqual(ids([...small, ...fits.flat()]));
    expect(read).toMatchObject({ lastSeq: huge[0].seq, complete: true });
    // the read's gap, said once (the stream, resumed on the next channel, says its own at `{seq, idx}`)
    expect(gapsOf(l.a, 'app-1').filter((g) => (g.at as { idx?: number } | undefined)?.idx === undefined)).toEqual([{ appSessionId: 'app-1', launchId: s.launchId, at: { seq: huge[0].seq } }]);
    // the device's reads (a channel's client), not the machine's in-process stream catch-up
    const asked = l.host.calls.slice(opening).filter((c) => c.name === 'session.events' && c.client !== undefined).map((c) => (c.input as { maxBytes?: number }).maxBytes !== undefined);
    // only the lost page carried the budget, to the peer that listed it; its resend and every page after are M2's
    expect(asked.indexOf(true)).toBe(0);
    expect(asked.filter(Boolean)).toHaveLength(1);
    expect(asked.length).toBeGreaterThan(2);
  });

  it('still tries an idle stream on the backoff for an endpoint without feeds, which carries no record', async () => {
    endpointWithout('rl2.feeds');
    const l = await lab();
    l.host.stored.set('app-r', []);
    l.place('app-r', 'eng-r');
    l.a.tabs('app-r');
    await until(() => sessionOf(l.a, 'app-r')?.stream === 'idle', 'the stream ended unavailable: not live');
    const placements = () => l.host.calls.filter((c) => c.name === 'session.status' && (c.input as { appSessionId: string }).appSessionId === 'app-r').length;
    const first = placements();
    await until(() => placements() >= first + 2, 'the subscription tried again on the backoff');
  });

  it('hydrates a launch whose history is over the channel’s 4 MiB in pages, a row too large to cross left out with a gap at its place (an endpoint without the byte budget)', async () => {
    endpointWithout('rl2.events-budget');
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    const small = l.host.row('app-1', 2);
    await opened(l.a, 'app-1', s.launchId);
    // Rows the stream hasn't carried: three of 1.5 MiB (4.5 MiB together), then one of 5 MiB that no answer can hold.
    const big = (bytes: number) => {
      const seq = s.rows.length + 1;
      const row = [l.host.event(s, seq, 0, { kind: 'note', text: 'x'.repeat(bytes) })];
      s.rows.push(row);
      return row;
    };
    const fits = [big(1.5 * 1024 * 1024), big(1.5 * 1024 * 1024), big(1.5 * 1024 * 1024)];
    const huge = big(5 * 1024 * 1024);
    const answer = (await l.a.cmd('session.events', { appSessionId: 'app-1', afterSeq: null, limit: null })) as { events: SessionEvent[]; lastSeq: number; complete: boolean; historyUnavailable?: true };
    expect(ids(answer.events)).toEqual(ids([...small, ...fits.flat()]));
    expect(answer).toMatchObject({ lastSeq: huge[0].seq, complete: true });
    expect(answer.historyUnavailable).toBeUndefined();
    expect(gapsOf(l.a, 'app-1')).toEqual([{ appSessionId: 'app-1', launchId: s.launchId, at: { seq: huge[0].seq } }]);
    // More than one page crossed: the host was asked again with a limit after the whole read was refused.
    expect(l.host.calls.filter((c) => c.name === 'session.events' && (c.input as { limit: number | null }).limit !== null).length).toBeGreaterThan(1);
  });

  it('resumes a session whose launch exited with the host’s row kept, rather than sealing a send to the exited launch', async () => {
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    const ended = s.launchId;
    l.host.exit('app-1'); // a stop, a crash, a budget or idle release: the row stays, with both ids
    await until(() => (of(l.a, 'session.status', 'app-1').at(-1)?.status as { process: string }).process === 'exited', 'the exited status streamed');
    expect(await l.a.cmd('session.send', { appSessionId: 'app-1', content: 'after the exit' })).toMatchObject({ disposition: 'queued' });
    expect(l.f.spine.acquired).toEqual(['app-1']);
    expect(s.launchId).not.toBe(ended);
    expect(l.host.runs).toEqual([{ appSessionId: 'app-1', content: 'after the exit', launchId: s.launchId }]);
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
    endpointWithout('rl2.executor.machine');
    const l = await lab();
    l.place('app-r', 'eng-r');
    expect(l.a.link.peerCapabilities()).not.toContain('rl2.executor.machine');
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
    // told where the hole ends: the first event the stream still had after it (P5 O7 M2's second review)
    await until(() => eventsOf(l.a, 'app-1').some((e) => e.id === kept[0].id), 'what the ring kept');
    expect(gapsOf(l.a, 'app-1')[1]).toEqual({ appSessionId: 'app-1', launchId: s.launchId, at: { seq: kept[0].seq, idx: 0 } });
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

  // ---- P5 O7 M4 ------------------------------------------------------------------------------------------------------

  it('uploads a 5 MiB file in three parts, each its own act, across a forced drop, writing it once', async () => {
    const l = await lab();
    const repo = await gitRepo();
    l.host.add('app-1');
    l.place('app-1', undefined, { directory: repo.root });
    checkoutServices(l, repo);
    // The second part runs on the machine, then its answer is lost and its channel cut.
    let cut = 0;
    const upload = l.f.spine.handlers.get('files.upload')!;
    l.f.spine.handle('files.upload', async (input, context) => {
      const answer = await upload(input, context);
      if ((input as FilesUploadInput).part?.index === 1 && cut++ === 0) {
        const { carrier, tap } = l.a.carriers.at(-1)!;
        tap.mute = true;
        setTimeout(() => carrier.close('dropped'), 20);
      }
      return answer;
    });
    const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(5 * MiB - 9)]);
    const answer = (await l.a.cmd('files.upload', { appSessionId: 'app-1', files: [{ name: 'spec.pdf', bytes: bytes.toString('base64') }] })) as FilesUploadOutput;
    expect(cut).toBe(1);
    expect(l.a.carriers.length).toBeGreaterThan(1); // the rest went on the next channel
    if (answer.status !== 'ok') throw new Error(`refused: ${answer.reason}`);
    expect(answer.paths).toHaveLength(1);
    expect(relative(join(repo.root, '.claude', 'desk-uploads', 'app-1'), answer.paths[0])).not.toMatch(/^\.\./);
    expect(readFileSync(answer.paths[0]).equals(bytes)).toBe(true);
    // each part ran once: the lost one's resend answered from the machine's ledger, under its own opId
    expect(l.f.spine.claimed.filter((c) => c.name === 'files.upload').map((c) => (c.input as FilesUploadInput).part)).toEqual([0, 1, 2].map((index) => ({ upload: expect.any(String), index, last: index === 2 })));
    expect(new Set(l.f.spine.claimed.map((c) => c.op?.opId)).size).toBe(3);
    expect(of(l.a, 'remote.upload', 'app-1').map((p) => p.sent)).toEqual([0, 1, 2, 3]);
  });

  // M4's milestone review: a read whose answer the channel can't carry (an image the viewer reads whole, base64 past
  // 4 MiB) crosses as ranged reads, assembled into the one answer the renderer asked for.
  it('reads a 6 MiB image whole over the channel in pages, byte for byte', async () => {
    const l = await lab();
    const repo = await gitRepo();
    l.place('app-r', 'eng-r', { directory: repo.root });
    checkoutServices(l, repo);
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(6 * MiB - 8)]);
    writeFileSync(repo.path('shot.png'), bytes);
    const opening = l.host.calls.length;
    const read = (await l.a.cmd('files.read', { appSessionId: 'app-r', path: repo.path('shot.png'), offset: 0, length: 8 * MiB })) as FilesReadOutput;
    expect(read).toMatchObject({ encoding: 'base64', bytes: bytes.length, offset: 0, length: bytes.length, truncated: false, mime: 'image/png', hash: null });
    expect(Buffer.from(read.content, 'base64').equals(bytes)).toBe(true);
    const pages = l.host.calls.slice(opening).filter((c) => c.name === 'files.read');
    expect(pages.length).toBeGreaterThan(2); // refused whole, then ranged
  });

  it('re-reads a text file whose escaped answer is past 4 MiB with its hash over the channel in pages, the hash the whole file’s (the editor’s conflict re-read)', async () => {
    const l = await lab();
    const repo = await gitRepo();
    l.place('app-r', 'eng-r', { directory: repo.root });
    checkoutServices(l, repo);
    const text = Array.from({ length: 6 * 1024 }, (_, i) => `${String(i).padStart(6, '0')} ${'é"\\'.repeat(200)}`.slice(0, 1023)).join('\n');
    writeFileSync(repo.path('big.md'), text);
    const read = (await l.a.cmd('files.read', { appSessionId: 'app-r', path: repo.path('big.md'), offset: 0, length: 8 * MiB, hash: true })) as FilesReadOutput;
    expect(read).toMatchObject({ encoding: 'utf8', offset: 0, truncated: false, hash: sha256(text), utf8: true });
    expect(read.content).toBe(text);
    expect(read.length).toBe(Buffer.byteLength(text));
  });

  it('saves a file on an idle session as a `machine` act, without resuming it', async () => {
    const l = await lab();
    const repo = await gitRepo();
    l.place('app-r', 'eng-r', { directory: repo.root }); // a record and no host row: released as idle
    checkoutServices(l, repo);
    l.a.tabs('app-r');
    await until(() => sessionOf(l.a, 'app-r')?.stream === 'idle', 'the session open and idle');
    const readme = repo.path('README.md');
    expect(await l.a.cmd('files.write', { appSessionId: 'app-r', path: readme, content: 'bye\n', expectedHash: sha256('hello\n') })).toEqual({ status: 'ok', hash: sha256('bye\n') });
    expect(readFileSync(readme, 'utf8')).toBe('bye\n');
    expect(l.f.spine.claimed.map((c) => c.name)).toEqual(['files.write']);
    expect(l.f.spine.acquired).toEqual([]);
    expect(l.host.sessions.has('app-r')).toBe(false);
  });

  it('follows git and files watches over the checkout feed, and after a drop makes the git watch again and invalidates the files watch, which the renderer’s path installs anew', async () => {
    const l = await lab();
    const repo = await gitRepo();
    const s = l.host.add('app-1');
    l.place('app-1', undefined, { directory: repo.root });
    const files = checkoutServices(l, repo);
    await opened(l.a, 'app-1', s.launchId);
    await until(() => l.host.calls.some((c) => c.name === 'git.status'), 'the feed’s bounds read');
    const page = { client: endableClientRef('page-panel'), session: 'app-1' as AppSessionId };
    const second = { client: endableClientRef('page-second'), session: 'app-1' as AppSessionId }; // another window's panel
    expect(((await l.a.cmd('git.watch', { directory: repo.root }, page)) as GitStatus).repoRoot).toBe(repo.root);
    await l.a.cmd('git.watch', { directory: repo.root }, second);
    await l.a.cmd('files.watch', { appSessionId: 'app-1', path: repo.root }, page);
    expect(files.watching()).toEqual([repo.root]);
    const untracked = (name: string) => (c: { status: GitStatus }) => c.status.files.some((x) => x.path === name && x.untracked);

    writeFileSync(repo.path('one.ts'), 'export {};\n');
    await until(() => filesChanges(l.a, 'app-1').some((c) => c.path === repo.path('one.ts')), 'the files change on the feed', 10_000);
    await until(() => gitChanges(l.a).some((c) => c.repoRoot === repo.root && untracked('one.ts')(c)), 'the git change on the feed', 10_000);

    // The channel drops: the machine releases what it held for it, and a file is made meanwhile.
    l.a.direct.dead = true;
    l.a.carriers.at(-1)!.carrier.close('dropped');
    await until(() => files.watching().length === 0 && files.followed.size === 0, 'the old channel’s watches released');
    writeFileSync(repo.path('two.ts'), 'export {};\n');
    const said = l.a.emitted.length;
    l.a.direct.dead = false;
    l.a.link.probe('network');
    await until(() => filesChanges(l.a, 'app-1').some((c) => c.kind === 'invalidated' && c.path === repo.root), 'the files watch invalidated', 15_000);
    await until(() => gitChanges(l.a).some((c) => c.reason === 'initial' && untracked('two.ts')(c)), 'the git watch made again, its status told', 15_000);
    expect(l.a.emitted.slice(said).filter((e) => e.name === 'files.changed' && e.payload.kind === 'invalidated')).toHaveLength(1);

    // The renderer's files store lists and watches again on the invalidation.
    const listing = (await l.a.cmd('files.list', { appSessionId: 'app-1', path: repo.root }, page)) as FilesListOutput;
    expect(listing.entries.map((e) => e.name)).toEqual(expect.arrayContaining(['one.ts', 'two.ts']));
    await l.a.cmd('files.watch', { appSessionId: 'app-1', path: repo.root }, page);
    expect(files.watching()).toEqual([repo.root]);
    expect(files.followed.size).toBe(1); // the new channel's ref only
    writeFileSync(repo.path('three.ts'), 'export {};\n');
    await until(() => filesChanges(l.a, 'app-1').some((c) => c.path === repo.path('three.ts')), 'a change on the reinstalled watch', 10_000);

    // Fix wave 1 (finding 2): the new channel holds the repository once per page; the second window closing leaves the
    // first's hold, so its changes still come.
    second.client.end();
    await new Promise((resolve) => setTimeout(resolve, 200));
    writeFileSync(repo.path('four.ts'), 'export {};\n');
    await until(() => gitChanges(l.a).some((c) => c.repoRoot === repo.root && untracked('four.ts')(c)), 'a git change after one page closed', 10_000);
  });

  // Fix wave 2 (finding 2): the git hold is the channel's and the directory's, whichever session asked for it.
  it('keeps two sessions’ git holds on one repository across a drop, so one session’s panel closing leaves the other’s changes coming', async () => {
    const l = await lab();
    const repo = await gitRepo();
    for (const app of ['app-1', 'app-2']) {
      l.host.add(app);
      l.place(app, undefined, { directory: repo.root });
    }
    checkoutServices(l, repo);
    l.a.tabs('app-1', 'app-2');
    await until(() => ['app-1', 'app-2'].every((app) => sessionOf(l.a, app)?.stream === 'live'), 'both sessions live', 10_000);
    const panels = ['app-1', 'app-2'].map((app) => ({ client: endableClientRef(`panel-${app}`), session: app as AppSessionId }));
    for (const panel of panels) await l.a.cmd('git.watch', { directory: repo.root }, panel);
    const untracked = (name: string) => (c: { status: GitStatus }) => c.status.files.some((x) => x.path === name && x.untracked);

    l.a.direct.dead = true;
    l.a.carriers.at(-1)!.carrier.close('dropped');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const said = l.a.emitted.length;
    l.a.direct.dead = false;
    l.a.link.probe('network');
    // each session's feed opens on the new channel and gives the repository's holds back
    await until(() => l.a.emitted.slice(said).filter((e) => e.name === 'git.changed' && (e.payload as { reason: string }).reason === 'initial').length >= 2, 'both feeds’ replays', 15_000);
    await new Promise((resolve) => setTimeout(resolve, 300));

    panels[1].client.end();
    await new Promise((resolve) => setTimeout(resolve, 300));
    writeFileSync(repo.path('after.ts'), 'export {};\n');
    await until(() => gitChanges(l.a).some((c) => c.repoRoot === repo.root && untracked('after.ts')(c)), 'a git change after one session’s panel closed', 10_000);
  });

  it('spawns as a member who owns nothing there once a grant gives them `spawn`, stepped up; the new session streams, takes a PDF’s upload, then one message naming its path', async () => {
    const l = await lab();
    await sminos(l.f); // the machine's presence names CHECKOUT
    const b = await l.device('macb', { member: 'B' });
    const repo = await gitRepo();
    checkoutServices(l, repo);
    const spawned: Array<{ input: unknown; op?: HandlerOp }> = [];
    l.f.spine.handle('session.spawn', (input, context) => {
      spawned.push({ input, ...(context.op && { op: context.op }) });
      l.host.add('app-new');
      l.f.spine.set('app-new', 'eng-app-new', { ...record('app-new', { engineSessionId: 'eng-app-new' as never, directory: repo.root }) });
      // what O12's observer will claim from `launchedBy`: the requester owns what they launched
      l.f.records.set({ lane: 'B', session: 'eng-app-new', owners: [context.op!.member] }, 'app-new');
      return { status: 'ok', appSessionId: 'app-new' };
    });
    const spawn = { checkout: CHECKOUT, permission_mode: 'default' }; // no brief: the attachment goes first
    expect(await b.route('session.spawn', spawn)).toMatchObject({ ok: false, error: { issues: { refusal: 'grade' } } });
    expect(await grantSpawn(l.f, org.B)).toBe(`kept: version 1 for member ${org.B}, spawn`);
    const confirmed = b.confirmed.length;
    expect(await b.cmd('session.spawn', spawn)).toEqual({ status: 'ok', appSessionId: 'app-new' });
    expect(b.confirmed).toHaveLength(confirmed + 1); // asked at the sheet before it was sent
    expect(spawned).toEqual([{ input: spawn, op: expect.objectContaining({ member: org.B, device: 'macb' }) }]);
    expect((spawned[0].op!.action as Action).stepUp).toEqual(expect.any(String));

    // The tab moves to the new session, which streams.
    await opened(b, 'app-new', l.host.session('app-new').launchId);
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(3 * MiB)]);
    const uploaded = (await b.cmd('files.upload', { appSessionId: 'app-new', files: [{ name: 'brief.pdf', bytes: pdf.toString('base64') }] })) as FilesUploadOutput;
    if (uploaded.status !== 'ok') throw new Error(`refused: ${uploaded.reason}`);
    expect(readFileSync(uploaded.paths[0]).equals(pdf)).toBe(true);
    const text = `Read @${relative(repo.root, uploaded.paths[0])}`;
    expect(await b.cmd('session.send', { appSessionId: 'app-new', content: text })).toMatchObject({ disposition: 'queued' });
    expect(l.host.runs).toEqual([{ appSessionId: 'app-new', content: text, launchId: l.host.session('app-new').launchId }]);
    await until(() => eventsOf(b, 'app-new').length > 0, 'the send’s row streamed');
  });

  it('opens a parked session whose newest window, and an older page, are each over 4 MiB with paged rows and a working cursor, never the bar (acceptance 12)', async () => {
    const l = await lab();
    const s = l.host.add('app-p');
    // The transcript the engine host reads from disk: its events carry no seq. Fourteen of 700 KiB, about 9.6 MiB.
    const history = Array.from({ length: 14 }, (_, i) => ({ ...l.host.event(s, i + 1, 0, { kind: 'note', text: `${i + 1}:${'p'.repeat(700 * 1024)}` }), id: `app-p:disk:${i + 1}`, seq: null }) as unknown as SessionEvent);
    l.host.stored.set('app-p', history);
    l.host.sessions.delete('app-p');
    l.place('app-p');
    l.a.tabs('app-p');
    await until(() => sessionOf(l.a, 'app-p')?.stream === 'idle', 'the parked session open');
    expect(utf8(history)).toBeGreaterThan(4 * MiB); // the newest window, unbounded, is past the channel

    const newest = (await l.a.cmd('session.events', { appSessionId: 'app-p', afterSeq: null, limit: null })) as Events;
    expect(newest.historyUnavailable).toBeUndefined();
    expect(newest.events.at(-1)!.id).toBe(history.at(-1)!.id);
    expect(newest.earlier).toBe(newest.events[0].id);
    const first = history.findIndex((e) => e.id === newest.events[0].id);
    expect(utf8(history.slice(0, first))).toBeGreaterThan(4 * MiB); // and so is the page before it
    const pages = [newest.events];
    for (let cursor = newest.earlier; cursor !== undefined; ) {
      const older = (await l.a.cmd('session.events', { appSessionId: 'app-p', afterSeq: null, limit: null, before: cursor })) as Events;
      expect(older.events.length).toBeGreaterThan(0);
      expect(older.historyUnavailable).toBeUndefined();
      pages.unshift(older.events);
      cursor = older.earlier;
    }
    expect(pages.length).toBeGreaterThan(2);
    expect(ids(pages.flat())).toEqual(ids(history));
    expect(of(l.a, 'remote.historyTooLarge', 'app-p')).toEqual([]);
    expect(gapsOf(l.a, 'app-p')).toEqual([]);
    expect(l.host.calls.filter((c) => c.name === 'session.events').every((c) => (c.input as { maxBytes?: number }).maxBytes !== undefined)).toBe(true);
  });

  it('keeps M2’s bar for a parked session’s window too large for the channel on an endpoint without the byte budget, sending it no budget', async () => {
    endpointWithout('rl2.events-budget');
    const l = await lab();
    const s = l.host.add('app-p');
    const history = Array.from({ length: 8 }, (_, i) => ({ ...l.host.event(s, i + 1, 0, { kind: 'note', text: 'p'.repeat(700 * 1024) }), id: `app-p:disk:${i + 1}`, seq: null }) as unknown as SessionEvent);
    l.host.stored.set('app-p', history);
    l.host.sessions.delete('app-p');
    l.place('app-p');
    expect(await l.a.cmd('session.events', { appSessionId: 'app-p', afterSeq: null, limit: null })).toEqual({ events: [], lastSeq: 0, complete: true, historyUnavailable: true });
    expect(of(l.a, 'remote.historyTooLarge', 'app-p')).toEqual([{ appSessionId: 'app-p', window: 'newest' }]);
    expect(l.host.calls.filter((c) => c.name === 'session.events').some((c) => (c.input as { maxBytes?: number }).maxBytes !== undefined)).toBe(false);
  });

  it('hydrates a live launch over 4 MiB in budgeted pages, a row alone past the budget a gap at its place', async () => {
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    const small = l.host.row('app-1', 2);
    await opened(l.a, 'app-1', s.launchId);
    const big = (bytes: number) => {
      const row = [l.host.event(s, s.rows.length + 1, 0, { kind: 'note', text: 'x'.repeat(bytes) })];
      s.rows.push(row);
      return row;
    };
    const fits = [big(1.5 * MiB), big(1.5 * MiB), big(1.5 * MiB)];
    const huge = big(5 * MiB);
    // The machine's stream catch-up reads its own engine host in process (stream-catchup.ts); only the command's reads cross.
    const opening = l.host.calls.length;
    const answer = (await l.a.cmd('session.events', { appSessionId: 'app-1', afterSeq: null, limit: null })) as Events;
    expect(ids(answer.events)).toEqual(ids([...small, ...fits.flat()]));
    expect(answer).toMatchObject({ lastSeq: huge[0].seq, complete: true });
    expect(answer.historyUnavailable).toBeUndefined();
    expect(gapsOf(l.a, 'app-1')).toEqual([{ appSessionId: 'app-1', launchId: s.launchId, at: { seq: huge[0].seq } }]);
    const asked = l.host.calls.slice(opening).filter((c) => c.name === 'session.events').map((c) => c.input as { limit: number | null; maxBytes?: number });
    expect(asked.length).toBeGreaterThan(2);
    expect(asked.every((a) => a.maxBytes !== undefined && a.limit === null)).toBe(true);
  });

  it('sends no call session and opens no feed to an endpoint that lists neither: its checkout read is refused, its changes never arrive', async () => {
    endpointWithout('rl2.call-session', 'rl2.feeds');
    const l = await lab();
    const repo = await gitRepo();
    const s = l.host.add('app-1');
    l.place('app-1', undefined, { directory: repo.root });
    checkoutServices(l, repo);
    await opened(l.a, 'app-1', s.launchId);
    expect(await l.a.route('git.status', { directory: repo.root }, { session: 'app-1' as AppSessionId })).toMatchObject({ ok: false, error: { issues: { refusal: 'no-target' } } });
    l.host.emitMachine('files.changed', { appSessionId: 'app-1', path: repo.path('a.ts'), kind: 'created' });
    await sleep(200);
    expect(filesChanges(l.a, 'app-1')).toEqual([]);
  });
});
