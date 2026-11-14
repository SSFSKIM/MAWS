// Remote lane B through a real link against a real endpoint (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// M2's "Proves" for this file; acceptance 1's main half and acceptance 5): the endpoint's own harness
// (test/endpoint/sub-harness.ts) on its direct listener at loopback, with its fake engine host and fake spine; O7's
// `createRemoteLink` driven by the profile's real device keys as a device of the machine's owner
// (test/machines/remote-link.test.ts's pattern); and the adapter reached as the router reaches it, `routeLaneB` over the
// manager's path, which here is `dispatchOverLink` on the same link (how the pane's reads reach the machine). The tabs
// are a `main.tabs` value the suite moves.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, get as httpGet, type Server } from 'node:http';
import { connect as dialTcp, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { keyId, memoryOrgView, signRecord, SIGNING_DOMAINS, type Action, type ByteDuplex, type Grant, type SignedOrgState } from 'org-protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { endableClientRef, type ClientRef, type EndableClientRef, type HandlerContext, type HandlerOp } from '@shared/ipc/client';
import type { FilesListOutput, FilesReadOutput, FilesUploadInput, FilesUploadOutput } from '@shared/ipc/schema/files';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { PtyAttach } from '@shared/ipc/schema/pty';
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { CommandName, CommandResult, EventName } from '@shared/ipc/schema';
import { NO_PROJECT } from '@shared/ipc/schema/layout';
import type { RemoteSession } from '@shared/ipc/schema/remote';
import { validateEventPayload } from '@shared/ipc/validate';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { loadDeviceKeys } from '../../src/main/device/keys';
import { createStepUp } from '../../src/main/device/step-up';
import type { ClientWindowShown } from '../../src/main/client/window-shown';
import { harnessConfirmation } from '../../src/main/device/step-up-sheet';
import { DEVICE_CAPABILITIES } from '../../src/main/machines/remote/capabilities';
import type { MainContext } from '../../src/main/ipc/router';
import { createRemoteLaneB, ENGINE_HOST_ACTS, MACHINE_ACTS, routeLaneB, type RemoteLaneB, type RemoteLaneBTiming } from '../../src/main/lane-b/remote';
import { PTY_ACTS } from '../../src/main/lane-b/remote-pty';
import { dialDirect } from '../../src/main/machines/remote/carriers';
import { dispatchOverLink } from '../../src/main/machines/remote/dispatch';
import { createRemoteLink, type RemoteLink } from '../../src/main/machines/remote/link';
import type { RemoteTiming } from '../../src/main/machines/remote/timing';
import type { CommandBudgets } from '../../src/main/machines/budgets';
import { COMMAND_BUDGETS_MS } from '../../src/services/command-budgets';
import { validateCommandOutput } from '@shared/ipc/validate';
import { heldOrgSession, watchedView, type SignedIn } from '../../src/main/org/session';
import { OFFERS } from '../../src/endpoint/offers';
import { registerFilesHandlers, type FilesHandlers } from '../../src/services/files/register';
import { createUpload } from '../../src/services/files/upload';
import { registerGitHandlers } from '../../src/services/git/register';
import { WorktreeService } from '../../src/services/git/worktrees';
import { registerWorktreeHandlers } from '../../src/services/git/worktrees-register';
import { createGitRunner } from '../../src/services/git/runner';
import { GitService } from '../../src/services/git/service';
import { GitFixture } from '../support/git-fixture';
import { endorsed, iso, retiredDevice, successor } from '../endpoint/org-fixtures';
import { CHECKOUT, FakeEngineHost, makeOrg, openRemote, ORG, sleep, sminos, startEndpoint, stopAll, until, type Fixture, type HostSession, type Org, type StartOptions } from '../endpoint/sub-harness';
import { FakePtyHost } from '../endpoint/fake-pty-host';
import { fakeAssetHolds } from '../endpoint/fake-services';
import { createDatasetHolds } from '../../src/main/dashboard/holds';
import { item, project, record, status } from '../support/builders';
import { fakeBus } from '../support/fake-bus';
import { CONNECTOR_ART, CONNECTOR_FP, FakeConnectorHost } from '../support/fake-connector-host';
import { fakeSpineView } from '../support/fake-spine-view';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import type { AttentionItem } from '@shared/graph/attention';
import type { NotificationHandle, NotifyRequest } from '@shared/client/port';
import { startNotifier } from '../../src/main/attention/notifier';
import { DaemonClocks } from '../../src/mawsd/clocks';
import { engineRequests } from '../../src/mawsd/engine-requests';
import { EventEmitter } from 'node:events';
import { decodeFrame, encodeFrame, type Frame } from '@artifacts/provider/frames';
import { PortProvider } from '@artifacts/provider/port';
import { applyV1, diffV1, newDoc, onUpdate, stateVector, transact, type Doc } from '@artifacts/yjs';
import { DOC_PORT_CHANNEL } from '@shared/ipc/doc-port';
import { startArtifacts, type ArtifactsDeps } from '../../src/main/artifacts';
import { clientOf } from '../../src/main/ipc/clients';
import { BRIDGE_SCRIPT } from '../../src/services/artifacts/scheme/bridge-script';
import { fakeDocuments, fakeServices, scratchArtifacts, type FakeServices } from '../endpoint/fake-services';
import { End } from './port-pair';
// P5 O7 M5c: the machine's connectors and delivery as the spine's root composes them; main's own connectors for this Mac
import { oauthIdentityOf } from '@shared/connectors/oauth-types';
import type { DirectSource } from '@shared/ipc/schema/connectors';
import { artifactExportName } from '@shared/maws/tools';
import { startAppConnectors } from '../../src/main/connectors';
import { createServicesFront, type ServicesFront } from '../../src/mawsd/front';
import { composeConnectors } from '../../src/services/connectors';
import { fileKeyCustody } from '../../src/services/connectors/custody';
import type { DirectRoute } from '../../src/services/connectors/direct-route';
import type { ConnectorOAuthProvider } from '../../src/services/connectors/oauth-provider';
import { productionConnectorOAuth } from '../../src/services/connectors/root';
import { startDelivery } from '../../src/services/delivery';

// The endpoint's `h2` list, the build's own by default, which a case narrows to an endpoint of an earlier build (before the
// `machine` executor, before M4's byte budget); each case starts from the whole list again.
const endpointCaps = vi.hoisted(() => ({ list: [] as string[], full: [] as string[] }));
vi.mock('../../src/endpoint/capabilities', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/endpoint/capabilities')>();
  endpointCaps.full = [...real.ENDPOINT_CAPABILITIES];
  endpointCaps.list.splice(0, Infinity, ...endpointCaps.full);
  return { ENDPOINT_CAPABILITIES: endpointCaps.list };
});
// P5 O7 M5b: main's scheme chain as `startArtifacts` installs it on the window's session (src/main/artifacts/index.ts):
// the handler it hands the default session's `protocol.handle`, which a case calls with `Request`s as Chromium would.
const schemes = vi.hoisted(() => ({ handlers: [] as Array<(request: Request) => Promise<Response>> }));
vi.mock('electron', () => {
  const session = (kept: boolean) => ({ protocol: { handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => void (kept && schemes.handlers.push(handler)) } });
  return { protocol: {}, MessageChannelMain: class {}, systemPreferences: {}, session: { defaultSession: session(true), fromPartition: () => session(false) } };
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
/** P5 O7 M5c: a page's window as the window reporter reads it (ClientWindowShown), which a case shows and hides. */
type ShownWindow = ClientWindowShown & { set(shown: boolean): void };
function shownWindow(shown: boolean): ShownWindow {
  const listeners = new Set<() => void>();
  return {
    shown: () => shown,
    closed: () => false,
    onChange: (listener) => (listeners.add(listener), () => void listeners.delete(listener)),
    set(next) {
      shown = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
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
  /** P5 O7 M5c: what main told its windows as its own word (`emitOwn`; `connectors.reset {machine}`). */
  own: Emitted[];
  /** P5 O7 M5c: a page of this app whose window is shown or not, as the window reporter reads it. */
  page(id: string, shown?: boolean): { client: EndableClientRef; window: ShownWindow };
  /** P5 O7 M5c: each URL a machine's services asked this device to open (the consent's), in order. */
  opened: string[];
  /** P5 O7 M3: the app quit and started again on this Mac: a new link and a new adapter under the same device keys. */
  restart(): Promise<Device>;
  /** P5 O7 M3: `remote.forward.open` and `.close`, as main's handlers take them. */
  forward(op: 'open' | 'close', port: number): Promise<CommandResult<CommandName>>;
  tabs(...apps: string[]): void;
  /** P5 O7 M6: the roster says the machine, as `Machines.onRemote` does once the manager made its link. */
  roster(): void;
  /** `from`: the page and the session a path-class command is made from (MainContext's `client` and `session`). */
  route(name: string, input: unknown, from?: Partial<MainContext>): Promise<CommandResult<CommandName>>;
  cmd(name: string, input: unknown, from?: Partial<MainContext>): Promise<unknown>;
};
type Lab = { f: Fixture; host: LaneBHost; pty: FakePtyHost; chain: SignedOrgState[]; a: Device; device(id: string, options?: DeviceOptions): Promise<Device>; place(app: string, engine?: string, fields?: Record<string, unknown>): void };
/** `member`: whose device it is (A, the machine's owner, by default; B, a member who owns nothing there). */
type DeviceOptions = { link?: Partial<RemoteTiming>; adapter?: Partial<RemoteLaneBTiming>; member?: 'A' | 'B'; budgets?: CommandBudgets /* P5 O7 M5a: the link's per-command budgets */ };
/** P5 O7 M3: the endpoint's own seams (a forward's window), and the pty host's ring. */
type LabOptions = DeviceOptions & { endpoint?: Pick<StartOptions, 'subscriptions' | 'services' /* P5 O7 M5b: the machine's document host */>; ring?: number };

/** The endpoint with the suite's engine host and a pty host, and device `mac1` of its owner (A) up on it. */
async function lab(options: LabOptions = {}): Promise<Lab> {
  const host = new LaneBHost();
  const pty = new FakePtyHost(options.ring);
  const f = await startEndpoint(org, started, { limits: OPEN, host, pty, ...options.endpoint });
  host.attach(true); // lane B events available (mawsd's permanent link)
  const l = {
    f,
    host,
    pty,
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
  return connect(l, id, keys, member, mac, options);
}

/** The app on the device: its org session under the device's keys, its link up, its adapter reached through `routeLaneB`. */
async function connect(l: Lab, id: string, keys: Awaited<ReturnType<typeof loadDeviceKeys>>, member: string, mac: Device['mac'], options: DeviceOptions): Promise<Device> {
  const { f } = l;
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
    records: { resolve: async () => ({ body: { org: ORG, machine: f.ref, addresses: ['ws://100.101.102.108:47830'], issued: iso(Date.now()) }, sig: { kid: 'k', alg: 'ES256', value: 'v' } }) as never, cached: async () => null },
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
    ...(options.budgets !== undefined && { budgets: options.budgets }),
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
  const own: Emitted[] = [];
  const windows = new Map<string, ShownWindow>();
  const opened: string[] = [];
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
    // P5 O7 M5b: the document bridge's channel, in memory (main mints a MessageChannelMain)
    docChannel: () => {
      const [port1, port2] = End.pair();
      return { port1, port2 } as never;
    },
    // P5 O7 M5c: main's own word to its windows, each page's window, and the URLs this device is asked to open
    emitOwn: (name, payload) => {
      const checked = validateEventPayload(name, payload);
      if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
      own.push({ name, payload: payload as Record<string, unknown> });
    },
    windowShown: (client) => windows.get(client.id) ?? null,
    openUrl: (url) => {
      opened.push(url);
      return { opened: true };
    },
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
    restart() {
      adapter.stop();
      link.close();
      return connect(l, id, keys, member, mac, options);
    },
    forward: (op, port) => (op === 'open' ? adapter.forward.open({ machine, port }) : adapter.forward.close({ machine, port })),
    roster() {
      for (const listener of [...remoteListeners]) listener([machine]);
    },
    tabs(...apps) {
      const list = apps.map((app) => ({ id: `session:${addressOf(machine, app as AppSessionId)}`, kind: 'session', appSessionId: addressOf(machine, app as AppSessionId), pinned: false }));
      tabs = { version: 3, current: NO_PROJECT, sets: { [NO_PROJECT]: { panes: [{ tabs: list, activeTabId: list[0]?.id ?? '' }], focusedPane: 0, splitRatio: 0.5 } }, closedTabs: [] };
      for (const listener of layoutListeners) listener('main.tabs');
    },
    confirmed,
    own,
    opened,
    page(pageId, shown = true) {
      const window = shownWindow(shown);
      windows.set(pageId, window);
      const client = endableClientRef(pageId);
      cleanups.push(() => client.end());
      return { client, window };
    },
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
  // 2026-11-06: the endpoint's bounds learn a root's repository from the worktree list (rev-parse, no status scan)
  registerWorktreeHandlers(new WorktreeService({ git: createGitRunner({ env: repo.serviceEnv() }), holders: { dispatch: () => Promise.reject(new Error('no holders here')), sessions: { list: () => [] } } as never }), f.spine.bus as never);
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
    for (const name of PTY_ACTS) expect([name, OFFERS.commands[name]]).toMatchObject([name, { kind: 'act', executor: 'pty-host' }]); // P5 O7 M3
    expect(OFFERS.commands['forward.open']).toMatchObject({ kind: 'act', executor: 'endpoint' });
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
    const clocks = new DaemonClocks('unit', { armEnginePark: () => (parks.push(Date.now()), true), disarmEnginePark: () => {}, exitDaemon: () => {}, quiet: () => {}, activity: () => {} });
    cleanups.push(() => clocks.stop());
    const needs = vi.spyOn(clocks, 'engineNeeded');
    const flips = vi.spyOn(clocks, 'interest');
    clocks.configure(1500);
    clocks.served();
    clocks.engineHost(4242);
    const services = l.f.services;
    const dispatch = services.dispatch.bind(services);
    const requests = engineRequests({ hosts: { forward: (owner, { name, input }) => dispatch(owner, name, input), onState: () => () => {}, parked: () => parks.length > 0, completionGone: () => false /* P5 O16 M3b */ }, clocks, log: () => {} });
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

  // The UX wave, U9 (M3; R4): a Stop that went out on a channel that then stalled is not answered offline: it may have run,
  // so it ends with the pending sentence UC-7.5 keeps, never "Not stopped: mini is offline"
  it('answers a Stop the channel carried and lost with the pending sentence, never as offline', async () => {
    const l = await lab({ adapter: { sendPendingMs: 500 } });
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    l.host.handlers.set('session.interrupt', () => ({ stillQueued: [], cancelled: [] }));
    l.a.carriers.at(-1)!.tap.mute = true; // nothing the endpoint says reaches the link: no ack, no done
    const stopping = l.a.route('session.interrupt', { appSessionId: 'app-1', cancelEngineQueued: false, holdEngineQueued: true });
    await until(() => l.host.arrived.includes('session.interrupt'), 'the Stop at the host');
    l.a.direct.dead = true;
    l.a.carriers.at(-1)!.carrier.close('dropped');
    expect(await stopping).toEqual({ ok: false, error: { code: 'timeout', message: 'mini took the request but hasn’t confirmed it' } });
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
    await until(() => l.host.calls.some((c) => c.name === 'git.worktree.list'), 'the feed’s bounds read');
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

  // ---- P5 O7 M3: terminals and forwarded ports ----------------------------------------------------------------------

  it('spawns a shell as a member with a `shell` grant, types into it and reads it back across a forced drop: nothing repeated, nothing lost, no second prompt', async () => {
    const l = await lab();
    expect(await grantRights(l.f, org.B, ['shell'])).toContain('shell');
    const b = await l.device('macb', { member: 'B' });
    const { ptyId } = (await b.cmd('pty.spawn', SPAWN)) as { ptyId: string };
    expect(b.confirmed).toHaveLength(1); // the spawn, at the sheet
    l.pty.emit(ptyId, 'prompt$ ');
    await until(() => screen(b, ptyId) === 'prompt$ ', 'the prompt');
    await b.cmd('pty.write', { ptyId, data: 'ls\r' });
    await until(() => typed(l, ptyId) === 'ls\r', 'the keystrokes');
    l.pty.emit(ptyId, 'ls\r\nfile\r\nprompt$ ');
    await until(() => screen(b, ptyId).endsWith('file\r\nprompt$ '), 'the echo');

    b.carriers.at(-1)!.carrier.close('dropped');
    // typed and printed while the channel is away
    await b.cmd('pty.write', { ptyId, data: 'pwd\r' });
    l.pty.emit(ptyId, 'pwd\r\n/work\r\n');
    await until(() => typed(l, ptyId) === 'ls\rpwd\r' && screen(b, ptyId).endsWith('/work\r\n'), 'the terminal on the next channel', 10_000);
    expect(b.carriers.length).toBeGreaterThan(1);
    expect(screen(b, ptyId)).toBe('prompt$ ls\r\nfile\r\nprompt$ pwd\r\n/work\r\n');
    await sleep(100);
    expect(typed(l, ptyId)).toBe('ls\rpwd\r'); // nothing written twice
    expect(b.confirmed).toHaveLength(1); // the stream opened again under the spawn's act
    expect(l.pty.runs).toEqual(['pty.spawn']);
  });

  it('types from a new app run under the same device keys without its first keystrokes dropped, restoring from the ring’s start', async () => {
    const l = await lab();
    const { ptyId } = (await l.a.cmd('pty.spawn', SPAWN)) as { ptyId: string };
    await l.a.cmd('pty.write', { ptyId, data: 'one\r' });
    await until(() => typed(l, ptyId) === 'one\r', 'the first run’s keystrokes');
    l.pty.emit(ptyId, 'one\r\n');
    const a2 = await l.a.restart();
    expect(await a2.cmd('pty.listFor', { appSessionId: 'app-1' })).toMatchObject({ ptys: [{ ptyId, label: 't1' }] });
    const attached = (await a2.cmd('pty.attach', { ptyId })) as PtyAttach;
    expect(attached).toMatchObject({ checkpoint: null, replayFrom: 0, nextOffset: 5, info: { ptyId, alive: true } });
    expect(Buffer.from(attached.replay).toString()).toBe('one\r\n');
    await a2.cmd('pty.write', { ptyId, data: 'two\r' }); // as long as the first run's: each run's input counts from zero
    await until(() => typed(l, ptyId) === 'one\rtwo\r', 'the new run’s keystrokes');
  });

  it('re-attaches a reloaded page (a new registry) from the adapter’s checkpoint and the ring past it, whatever the machine’s own viewer checkpointed', async () => {
    const l = await lab();
    const { ptyId } = (await l.a.cmd('pty.spawn', SPAWN)) as { ptyId: string };
    l.pty.emit(ptyId, 'hello world\r\n');
    await until(() => screen(l.a, ptyId) === 'hello world\r\n', 'the output');
    await l.a.cmd('pty.ack', { ptyId, offset: 13 });
    await l.a.cmd('pty.checkpoint', { ptyId, offset: 6, state: 'SCREEN@6' });
    l.pty.checkpoint(ptyId, 13); // the machine's own app checkpointed further
    l.pty.emit(ptyId, 'again');
    // The reload: the new page lists the session's terminals and attaches.
    expect(await l.a.cmd('pty.listFor', { appSessionId: 'app-1' })).toMatchObject({ ptys: [{ ptyId }] });
    const attached = (await l.a.cmd('pty.attach', { ptyId })) as PtyAttach;
    expect(attached).toMatchObject({ checkpoint: { offset: 6, state: 'SCREEN@6' }, replayFrom: 6, nextOffset: 18 });
    expect(Buffer.from(attached.replay).toString()).toBe('world\r\nagain');
    const said = ptyChunks(l.a, ptyId).length;
    l.pty.emit(ptyId, 'live');
    await until(() => ptyChunks(l.a, ptyId).length > said, 'live output after the attach');
    expect(ptyChunks(l.a, ptyId).slice(said).map((c) => [c.offset, Buffer.from(c.data).toString()])).toEqual([[18, 'live']]);
  });

  it('opens a terminal’s stream refused `unavailable` again on the backoff, resending the input the machine hadn’t taken', async () => {
    const l = await lab({ adapter: { streamRetryMs: [50, 200] } });
    const { ptyId } = (await l.a.cmd('pty.spawn', SPAWN)) as { ptyId: string };
    l.pty.emit(ptyId, 'a');
    await until(() => screen(l.a, ptyId) === 'a', 'the stream open');
    // the pty host's ledger can't answer for a while: a reopen is refused `unavailable`
    let ledgerDown = true;
    let refused = 0;
    const dispatch = l.pty.dispatch.bind(l.pty);
    l.pty.dispatch = async (name, input) => {
      if (!ledgerDown || name !== 'pty.opQuery') return dispatch(name, input);
      refused += 1;
      return { t: 'res', id: 'pty', ok: false, error: { code: 'host_unavailable', message: 'down' } };
    };
    l.a.carriers.at(-1)!.carrier.close('dropped');
    await l.a.cmd('pty.write', { ptyId, data: 'typed while away' });
    l.pty.emit(ptyId, 'b');
    await until(() => refused >= 2, 'two refused opens', 10_000);
    ledgerDown = false;
    await until(() => screen(l.a, ptyId) === 'ab' && typed(l, ptyId) === 'typed while away', 'the stream open again', 10_000);
    await sleep(100);
    expect(typed(l, ptyId)).toBe('typed while away');
  });

  it('says a pty’s exit with its status once its output is in', async () => {
    const l = await lab();
    const { ptyId } = (await l.a.cmd('pty.spawn', SPAWN)) as { ptyId: string };
    l.pty.emit(ptyId, 'bye\r\n');
    await until(() => screen(l.a, ptyId) === 'bye\r\n', 'the output');
    l.pty.exit(ptyId);
    await until(() => l.a.emitted.some((e) => e.name === 'pty.exit'), 'the exit');
    expect(l.a.emitted.filter((e) => e.name === 'pty.exit').map((e) => e.payload)).toEqual([{ ptyId, exitCode: 0, signal: null }]);
  });

  it('opens a stream the endpoint closed `behind` again from its last offset once the renderer has taken what it was given; what the ring no longer holds is a gap', async () => {
    const l = await lab();
    const { ptyId } = (await l.a.cmd('pty.spawn', SPAWN)) as { ptyId: string };
    l.pty.emit(ptyId, 'ready');
    await until(() => screen(l.a, ptyId) === 'ready', 'the stream open');
    const flood = randomBytes(MiB + 600 * 1024);
    for (let i = 0; i < flood.byteLength; i += 64 * 1024) l.pty.emit(ptyId, flood.subarray(i, i + 64 * 1024));
    await until(() => l.a.logs.some((line) => line.includes(`terminal ${ptyId} on mini: behind`)), 'the endpoint closing the stream behind', 10_000);
    const saidBytes = () => ptyChunks(l.a, ptyId).reduce((n, c) => n + c.data.byteLength, 0);
    const said = saidBytes(); // within the stream's credit, which the renderer hasn't given back
    expect(said).toBeLessThanOrEqual(MiB);
    await sleep(150);
    expect(saidBytes()).toBe(said); // not opened again until the renderer takes what it was given
    await l.a.cmd('pty.ack', { ptyId, offset: said });
    const total = 5 + flood.byteLength;
    await until(() => ptyChunks(l.a, ptyId).at(-1)!.offset + ptyChunks(l.a, ptyId).at(-1)!.data.byteLength === total, 'the rest from the ring', 10_000);
    const after = ptyChunks(l.a, ptyId).filter((c) => c.offset >= said);
    const ringStart = total - 512 * 1024;
    expect(after[0].offset).toBe(ringStart); // the gap the renderer draws as lost output
    expect(Buffer.concat(after.map((c) => c.data))).toEqual(flood.subarray(ringStart - 5));
  });

  it('serves a fetch through a forwarded port, again after a forced drop with no new act within the window, and with one new act (one more confirmation for a non-owner) past it', async () => {
    const l = await lab({ endpoint: { subscriptions: { resumeMs: 400 } } });
    const server = await httpServer();
    expect(await grantRights(l.f, org.B, ['shell'])).toContain('shell');
    const b = await l.device('macb', { member: 'B', link: { BACKOFF_MS: [0, 100, 100] } });
    const opened = await b.forward('open', server.port);
    if (!opened.ok) throw new Error(`refused: ${opened.error.message}`);
    const { localPort } = opened.value as { localPort: number };
    expect(await get(localPort, '/one')).toBe('hello from /one');
    expect(b.confirmed).toHaveLength(1);
    expect(await b.forward('open', server.port)).toEqual({ ok: true, value: { localPort } }); // kept: no act

    // A drop within the window: the forward is named again on the next channel. A request made at the drop's instant may
    // be reset (§N), so the fetch waits for the next channel.
    let channel = b.link.peerCapabilities();
    b.carriers.at(-1)!.carrier.close('dropped');
    await onNewChannel(b, channel);
    expect(await get(localPort, '/two')).toBe('hello from /two');
    expect(b.confirmed).toHaveLength(1);

    // A drop past it: the endpoint forgot the forward; one fresh act.
    channel = b.link.peerCapabilities();
    b.direct.dead = true;
    b.carriers.at(-1)!.carrier.close('dropped');
    await until(() => l.f.endpoint.forwards.list().length === 0, 'the endpoint forgetting the forward', 5000);
    b.direct.dead = false;
    b.link.probe('network');
    await onNewChannel(b, channel);
    expect(await get(localPort, '/three')).toBe('hello from /three');
    expect(b.confirmed).toHaveLength(2);
    expect(await get(localPort, '/four')).toBe('hello from /four');
    expect(b.confirmed).toHaveLength(2);
    expect(await b.forward('close', server.port)).toEqual({ ok: true, value: undefined });
    await expect(get(localPort, '/closed')).rejects.toThrow();
  });

  it('answers a forward a member without `shell` asks for as the machine’s refusal, running nothing again', async () => {
    const l = await lab();
    const server = await httpServer();
    const b = await l.device('macb', { member: 'B' });
    expect(await b.forward('open', server.port)).toMatchObject({ ok: false, error: { issues: { refusal: 'grade' } } });
    expect(l.f.endpoint.forwards.list()).toEqual([]);
    expect(server.sockets).toEqual([]);
  });

  it('resets a connection to a port nothing listens on, and keeps the forward', async () => {
    const l = await lab();
    const server = await httpServer();
    const port = server.port;
    await closeServer(server);
    const opened = await l.a.forward('open', port);
    if (!opened.ok) throw new Error(`refused: ${opened.error.message}`);
    const { localPort } = opened.value as { localPort: number };
    await expect(get(localPort, '/nothing')).rejects.toThrow();
    expect(await l.a.forward('open', port)).toEqual({ ok: true, value: { localPort } });
  });

  it('ends a terminal and a forward when the `shell` grant is withdrawn mid-stream (`removed`), opening neither again', async () => {
    const l = await lab();
    const server = await httpServer();
    expect(await grantRights(l.f, org.B, ['shell'])).toContain('shell');
    const b = await l.device('macb', { member: 'B' });
    const { ptyId } = (await b.cmd('pty.spawn', SPAWN)) as { ptyId: string };
    l.pty.emit(ptyId, 'x');
    await until(() => screen(b, ptyId) === 'x', 'the terminal’s stream open');
    const opened = await b.forward('open', server.port);
    if (!opened.ok) throw new Error(`refused: ${opened.error.message}`);
    const { localPort } = opened.value as { localPort: number };
    // A connection held open (a request not yet whole), so its stream is open when the grant goes.
    const held = await dial(localPort);
    held.on('error', () => {});
    held.write('GET /held HTTP/1.1\r\nHost: 127.0.0.1\r\n');
    await until(() => server.sockets.length === 1, 'the held connection reaching the machine’s port');
    const reset = new Promise<void>((resolve) => held.once('close', () => resolve()));

    expect(await grantRights(l.f, org.B, [], 2)).toBe(`kept: version 2 for member ${org.B}, no rights`);
    await until(() => b.emitted.some((e) => e.name === 'pty.exit'), 'the terminal ended');
    expect(b.emitted.filter((e) => e.name === 'pty.exit').map((e) => e.payload)).toEqual([{ ptyId, exitCode: null, signal: null }]);
    await reset;
    const asked = l.pty.calls.filter((c) => c.name === 'pty.opQuery').length;
    await sleep(300);
    expect(l.pty.calls.filter((c) => c.name === 'pty.opQuery')).toHaveLength(asked); // the terminal's stream never opened again
    await expect(dial(localPort)).rejects.toThrow(); // the forward's listener closed with it
    expect(await b.route('pty.write', { ptyId, data: 'late' })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
  });

  it('answers a terminal and a forward locally `not-offered` against an endpoint that lists no `rl2.streams`, running no act', async () => {
    endpointWithout('rl2.streams');
    const l = await lab();
    expect(await l.a.route('pty.spawn', SPAWN)).toMatchObject({ ok: false, error: { issues: { refusal: 'not-offered' } } });
    expect(await l.a.forward('open', 8080)).toMatchObject({ ok: false, error: { issues: { refusal: 'not-offered' } } });
    expect(l.pty.runs).toEqual([]);
    expect(l.f.endpoint.forwards.list()).toEqual([]);
  });

  it('answers `pty.hostState` for the machine from its link: ready while up, starting while down, said again as it changes', async () => {
    const l = await lab({ link: { UP_GRACE_MS: 100, BACKOFF_MS: [0, 100, 100] } });
    expect(await l.a.cmd('pty.hostState', undefined)).toMatchObject({ state: 'ready', pid: null });
    const states = () => l.a.emitted.filter((e) => e.name === 'pty.hostState').map((e) => e.payload.state);
    l.a.direct.dead = true;
    l.a.carriers.at(-1)!.carrier.close('dropped');
    await until(() => states().at(-1) === 'starting', 'the link down');
    expect(await l.a.cmd('pty.hostState', undefined)).toMatchObject({ state: 'starting' });
    l.a.direct.dead = false;
    l.a.link.probe('network');
    await until(() => states().at(-1) === 'ready', 'the link up again', 5000);
  });
});

const SPAWN = { appSessionId: 'app-1', label: 't1', cwd: '/work', cols: 80, rows: 24 };
type PtyData = { ptyId: string; offset: number; data: Uint8Array };
const ptyChunks = (d: Device, ptyId: string) => d.emitted.filter((e) => e.name === 'pty.data' && e.payload.ptyId === ptyId).map((e) => e.payload as PtyData);
/** The terminal's output as said, each chunk at the offset after the one before (nothing repeated, nothing skipped). */
function screen(d: Device, ptyId: string): string {
  let at = 0;
  let text = '';
  for (const chunk of ptyChunks(d, ptyId)) {
    expect(chunk.offset).toBe(at);
    text += Buffer.from(chunk.data).toString();
    at += chunk.data.byteLength;
  }
  return text;
}
/** What the machine's pty host was written, in order. */
const typed = (l: Lab, ptyId: string) => l.pty.writes.filter((w) => w.ptyId === ptyId).map((w) => w.data).join('');

/** A grant of `rights` on the machine to `member`, signed by its admin (A). */
async function grantRights(f: Fixture, member: string, rights: Grant['rights'], version = 1): Promise<string> {
  const body: Grant = { org: ORG, machine: f.ref, machineKey: await keyId(f.key.pub), member, rights, version, issued: iso(Date.now()) };
  return (await f.endpoint.cli('grant', ['-'], JSON.stringify(await signRecord(SIGNING_DOMAINS.grant, body, org.a1.stepUp.privateKey, org.a1.stepUp.pub)))).out;
}

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await closeServer(server);
});
/** The link up on a channel after `was`: each channel's `h2` list is its own (`peerCapabilities()`), none while there is none. */
async function onNewChannel(d: Device, was: readonly string[] | null): Promise<void> {
  await until(() => {
    const now = d.link.peerCapabilities();
    return now !== null && now !== was && d.link.state() === 'up';
  }, `${d.id}'s link up on a new channel`, 10_000);
}
/** A dev server on the machine's loopback (this Mac's, in the suite). */
async function httpServer(): Promise<{ port: number; sockets: Socket[]; server: Server }> {
  const sockets: Socket[] = [];
  const server = createServer((req, res) => res.end(`hello from ${req.url}`));
  server.on('connection', (socket) => void sockets.push(socket));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, sockets, server };
}
async function closeServer(server: Server | { server: Server }): Promise<void> {
  const s = 'server' in server ? server.server : server;
  if (!s.listening) return;
  s.closeAllConnections();
  await new Promise((resolve) => s.close(resolve));
}
/** One GET on its own connection. */
function get(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpGet({ host: '127.0.0.1', port, path, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error(`GET ${path} timed out`)));
  });
}
function dial(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = dialTcp(port, '127.0.0.1', () => resolve(socket));
    socket.once('error', reject);
  });
}

// ---- P5 O7 M6: attention and search across machines ---------------------------------------------------------------------

/**
 * The machine's attention service, as its spine answers `attention.list` and emits `attention.changed` (owner `machine`):
 * a request raised on a session's launch is an item, settled when the request is answered.
 */
function machineAttention(l: Lab) {
  const items = new Map<string, AttentionItem[]>();
  l.f.spine.handle('attention.list', () => [...items.values()].flat());
  const set = (app: string, list: AttentionItem[]) => {
    if (list.length === 0) items.delete(app);
    else items.set(app, list);
    l.f.host.emitMachine('attention.changed', { appSessionId: app, items: list, silent: [] });
  };
  return {
    raise(app: string, kind: 'question' | 'permission', requestId: string): AttentionItem {
      l.host.request(app, kind, requestId);
      const raised = item(app, kind, new Date().toISOString(), { id: `att-${requestId}` as AttentionItem['id'], request: { requestId: requestId as never, toolUseId: `tu-${requestId}` as never, taskId: null, agentId: null } });
      set(app, [...(items.get(app) ?? []), raised]);
      return raised;
    },
    settle(app: string, requestId: string): void {
      set(app, (items.get(app) ?? []).filter((i) => i.request.requestId !== requestId));
    },
  };
}

/** The app's notifier over the device's adapter (this Mac's spine empty): the dock's badge and the notifications raised. */
function notifierOf(d: Device) {
  const badges: number[] = [];
  const raised: Array<{ request: NotifyRequest; closed: boolean }> = [];
  const stop = startNotifier(fakeSpineView(), {
    port: {
      notify: (_client, request) => {
        const shown = { request, closed: false };
        raised.push(shown);
        return { close: () => void (shown.closed = true) } satisfies NotificationHandle;
      },
      badge: (_client, count) => void badges.push(count),
      focus: () => ({ focused: false }) as never,
    },
    isFocused: () => false, // both windows unfocused
    isViewing: () => false,
    navigate: () => {},
    failure: () => {},
    settings: () => SETTINGS_DEFAULTS_V21,
    emit: () => true,
    emitFrom: () => true,
    remote: d.adapter.attention,
    now: () => Date.now() - 60_000,
  });
  cleanups.push(stop);
  return { badge: () => badges.at(-1), raised };
}

const attentionSaid = (d: Device) => d.emitted.filter((e) => e.name === 'remote.attention').map((e) => e.payload as { machine: string; items: AttentionItem[]; greyed: boolean });
const requestsOf = (items: AttentionItem[] | undefined) => (items ?? []).map((i) => i.request.requestId);

describe('attention and search across machines (P5 O7 M6)', { timeout: 30_000 }, () => {
  it('counts and raises a request on a session no tab holds, from the machine’s feed, and clears it everywhere once another device answers', async () => {
    const l = await lab();
    const b = await l.device('mac2');
    const service = machineAttention(l);
    const s = l.host.add('app-1');
    l.place('app-1');
    const seen = notifierOf(l.a);
    l.a.roster();
    await until(() => attentionSaid(l.a).length === 1, 'the feed’s first snapshot');
    expect(attentionSaid(l.a)).toEqual([{ machine: l.f.ref, items: [], greyed: false }]);

    service.raise('app-1', 'question', 'req-q');
    await until(() => itemsOf(l.a, 'app-1')?.length === 1, 'the request on a device with no tab');
    expect(of(l.a, 'remote.session', 'app-1')).toEqual([]); // nothing streamed: no tab holds it
    expect(seen.badge()).toBe(1);
    expect(seen.raised.map((n) => n.request.title)).toEqual(['mini']);

    await opened(b, 'app-1', s.launchId);
    expect(await b.cmd('session.answer', { appSessionId: 'app-1', requestId: 'req-q', answer: { kind: 'question', answers: { 'Which way?': 'left' } } })).toEqual({ outcome: 'delivered' });
    service.settle('app-1', 'req-q');
    await until(() => itemsOf(l.a, 'app-1')?.length === 0, 'the item cleared on the device with no tab');
    expect(seen.badge()).toBe(0);
    expect(seen.raised.map((n) => n.closed)).toEqual([true]);
    expect(attentionSaid(l.a)).toHaveLength(1);
  });

  // The UX wave, U9 (the architect's ruling of 2026-11-13): a machine's items grey by its phase, so a link forced down
  // and back within the minute keeps them counted; the greying at the minute is src/main/lane-b/remote-attention.test.ts'
  it('keeps the items counted while a link forced down reconnects, in the badge; the next up’s snapshot brings what came meanwhile, raising only that', async () => {
    const l = await lab({ link: { UP_GRACE_MS: 100 } });
    const service = machineAttention(l);
    l.host.add('app-1');
    l.place('app-1');
    const seen = notifierOf(l.a);
    l.a.roster();
    await until(() => attentionSaid(l.a).length === 1, 'the feed’s first snapshot');
    service.raise('app-1', 'question', 'req-q');
    await until(() => seen.badge() === 1, 'the request counted');

    l.a.direct.dead = true;
    l.a.carriers.at(-1)!.carrier.close('dropped');
    await until(() => l.a.link.state() === 'down', 'the link down past its grace');
    expect(attentionSaid(l.a).some((said) => said.greyed), 'reconnecting greys nothing').toBe(false);
    expect(seen.badge()).toBe(1);
    service.raise('app-1', 'permission', 'req-p'); // raised on the machine while this Mac can't hear it

    l.a.direct.dead = false;
    l.a.link.probe('network');
    await until(() => requestsOf(attentionSaid(l.a).at(-1)!.items).length === 2, 'the next snapshot', 15_000);
    expect(attentionSaid(l.a).at(-1)!.greyed).toBe(false);
    expect(requestsOf(attentionSaid(l.a).at(-1)!.items)).toEqual(['req-q', 'req-p']);
    expect(seen.badge()).toBe(1);
    expect(seen.raised.map((n) => n.request.body)).toEqual(['question for app-1', 'permission for app-1']); // the first not again
    expect(l.a.link.state()).toBe('up');
  });

  it('empties a session whose share is withdrawn mid-feed on a member’s device, keeping the feed and the other session', async () => {
    const l = await lab();
    const service = machineAttention(l);
    for (const app of ['app-1', 'app-2']) {
      l.host.add(app);
      l.place(app);
      l.f.records.set({ lane: 'B', session: `eng-${app}`, owners: ['@machine'], shares: [{ member: org.B, grade: 'view' }] }, app);
      service.raise(app, 'permission', `req-${app}`);
    }
    const b = await l.device('mac-b', { member: 'B' });
    const seen = notifierOf(b);
    b.roster();
    await until(() => attentionSaid(b).length === 1, 'the member’s snapshot');
    expect(requestsOf(attentionSaid(b)[0].items)).toEqual(['req-app-1', 'req-app-2']);
    expect(seen.badge()).toBe(2);

    l.f.records.set({ lane: 'B', session: 'eng-app-1', owners: ['@machine'] }, 'app-1');
    await until(() => itemsOf(b, 'app-1')?.length === 0, 'the withdrawn session emptied');
    expect(seen.badge()).toBe(1);
    service.raise('app-2', 'question', 'req-app-2b');
    await until(() => itemsOf(b, 'app-2')?.length === 2, 'the other session’s change');
    expect(attentionSaid(b)).toHaveLength(1); // the same feed: no reopening
    expect(b.link.state()).toBe('up');
  });

  it('asks no feed of an endpoint without `rl2.feeds`, saying nothing and surfacing no error', async () => {
    endpointWithout('rl2.feeds');
    const l = await lab();
    machineAttention(l);
    l.host.add('app-1');
    l.place('app-1');
    const seen = notifierOf(l.a);
    l.a.roster();
    await sleep(300);
    expect(attentionSaid(l.a)).toEqual([]);
    expect(l.a.logs.filter((line) => line.includes('attention'))).toEqual([]);
    expect(seen.badge()).toBe(0);
  });

  it('searches the machine over the link (`session.search` to `{machine}`), and answers `host_unavailable` while it is offline', async () => {
    const l = await lab({ link: { UP_GRACE_MS: 100, CALL_TIMEOUT_MS: 500 } });
    l.place('app-1');
    l.f.spine.handle('session.search', (input) => ({ hits: [{ appSessionId: 'app-1', snippet: `…${(input as { query: string }).query}…` }], indexing: false, incomplete: false }));
    expect(await l.a.cmd('session.search', { query: 'bisect' })).toEqual({ hits: [{ appSessionId: 'app-1', snippet: '…bisect…' }], indexing: false, incomplete: false });

    l.a.direct.dead = true;
    l.a.carriers.at(-1)!.carrier.close('dropped');
    await until(() => l.a.link.state() === 'down', 'the link down');
    expect(await l.a.route('session.search', { query: 'bisect' })).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
  });

  // fix wave 1: an endpoint older than M6 offers no `session.search`; main answers it as a machine left out
  it('answers `session.search` of an endpoint that offers none `host_unavailable`, as an offline machine', async () => {
    const commands = OFFERS.commands as Record<string, unknown>;
    const row = commands['session.search'];
    delete commands['session.search'];
    cleanups.push(() => void (commands['session.search'] = row));
    const l = await lab();
    expect(await l.a.route('session.search', { query: 'bisect' })).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: 'session.search: machine mini offers no search' } });
  });
});


// P5 O7 M5a (M5a's "Proves" for this file): a remote session's artifacts through the real channel and the real endpoint
// over the harness's artifact store: listed and read, written once across a lost answer, exported within its command's
// budget, its session's capabilities read and followed, and bytes both ways in the tagged form (never a fake dispatch).
describe('artifacts across machines (P5 O7 M5a)', { timeout: 30_000 }, () => {
  const ID = '9a1f0c4e-6b2d-4c8a-9e1f-2b3c4d5e6f70';
  const STATE = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) % 256);

  it('lists a remote session’s artifacts, reads one and its text, and records each on its machine', async () => {
    const l = await lab();
    l.host.add('app-1');
    l.place('app-1');
    const row = l.host.artifact(ID, ['app-1'], { kind: 'file', title: 'notes' });
    l.host.reads.set('artifacts.list', () => ({ artifacts: [row] }));
    l.f.spine.handle('library.read', () => ({ encoding: 'utf8', content: 'remote notes', bytes: 12, offset: 0, length: 12, truncated: false, mime: 'text/plain', hash: null, utf8: null }));
    expect(await l.a.cmd('artifacts.list', { filter: { appSessionId: 'app-1' } })).toEqual({ artifacts: [row] });
    expect(await l.a.cmd('artifacts.get', { artifactId: ID })).toEqual({ artifact: row });
    expect(await l.a.cmd('library.read', { artifactId: ID })).toMatchObject({ encoding: 'utf8', content: 'remote notes' });
  });

  it('renames an artifact across a forced drop that lost its answer, applied once; the feed’s reopening says the lost change’s re-read', async () => {
    const l = await lab();
    l.host.add('app-1');
    l.place('app-1');
    const held = l.host.artifact(ID, ['app-1']);
    l.a.roster(); // the machine's artifacts feed opens on the roster's link, its opening a re-read
    await until(() => l.a.emitted.some((e) => e.name === 'artifacts.resync'), 'the artifacts feed open');
    let cut = 0;
    l.host.handlers.set('artifacts.update', (input) => {
      const { artifactId, title } = input as { artifactId: string; title: string };
      const row = l.host.artifacts.get(artifactId)!.row;
      Object.assign(row, { title, revision: (row.revision as number) + 1 });
      l.host.emitHost('artifacts.changed', { artifactId, kind: row.kind, revision: row.revision, change: 'updated' });
      if (cut++ === 0) {
        const { carrier, tap } = l.a.carriers.at(-1)!;
        tap.mute = true;
        setTimeout(() => carrier.close('dropped'), 20);
      }
      return { artifact: row };
    });
    const answer = (await l.a.cmd('artifacts.update', { artifactId: ID, title: 'Renamed' })) as { artifact: Record<string, unknown> };
    expect(answer.artifact).toMatchObject({ id: ID, title: 'Renamed' });
    expect(l.a.carriers.length).toBeGreaterThan(1);
    expect(l.host.artifactRuns.filter((run) => run.name === 'artifacts.update')).toHaveLength(1);
    expect(held.title).toBe('Renamed');
    // the change went out on the channel whose answers were lost: the feed's opening on the next is a re-read
    await until(() => l.a.emitted.filter((e) => e.name === 'artifacts.resync').length >= 2, 'the re-read said from the machine at the reopening');
    l.host.emitHost('artifacts.changed', { artifactId: ID, kind: 'document', revision: 9, change: 'updated' });
    await until(() => l.a.emitted.some((e) => e.name === 'artifacts.changed' && e.payload.revision === 9), 'a later change said from the machine');
  });

  it('answers an export that takes longer than the link’s default deadline within its command’s budget', async () => {
    const l = await lab({ link: { CALL_TIMEOUT_MS: 500 }, budgets: COMMAND_BUDGETS_MS });
    l.host.artifact(ID, ['app-1']);
    l.f.spine.handle('artifacts.export', async () => (await sleep(1500), { path: `/m/artifacts/${ID}/exports/3-pdf.pdf`, revision: 3 }));
    expect(await l.a.cmd('artifacts.export', { artifactId: ID, format: 'pdf' })).toEqual({ path: `/m/artifacts/${ID}/exports/3-pdf.pdf`, revision: 3 });
    // an unbudgeted read held as long is given up on at the default
    l.f.spine.handle('library.spaces', async () => (await sleep(1500), { spaces: [] }));
    expect(await l.a.route('library.spaces', undefined)).toMatchObject({ ok: false, error: { code: 'timeout' } });
  });

  it('reads a remote session’s capabilities and follows their change on its checkout feed', async () => {
    const l = await lab();
    l.host.add('app-1');
    l.place('app-1');
    l.f.spine.handle('session.capabilities', () => ({ browser: { available: false, reason: 'no tab engine on mini' } }));
    expect(await l.a.cmd('session.capabilities', { appSessionId: 'app-1' })).toEqual({ browser: { available: false, reason: 'no tab engine on mini' } });
    await opened(l.a, 'app-1', 'launch-1');
    await until(() => l.host.calls.length > 0 && l.a.link.state() === 'up', 'the checkout feed');
    await sleep(100);
    l.host.emitMachine('session.capabilitiesChanged', { appSessionId: 'app-1', capabilities: { browser: { available: true } } });
    await until(() => of(l.a, 'session.capabilitiesChanged', 'app-1').length > 0, 'the change on the checkout feed');
    expect(of(l.a, 'session.capabilitiesChanged', 'app-1')).toEqual([{ appSessionId: 'app-1', capabilities: { browser: { available: true } } }]);
  });

  it('carries bytes both ways tagged: a version’s state read as a Uint8Array, a 64 KiB asset sealed, verified and written as sent', async () => {
    const l = await lab();
    l.host.artifact(ID, ['app-1']);
    l.host.reads.set('artifacts.versionState', () => ({ bytes: STATE }));
    const state = (await l.a.cmd('artifacts.versionState', { artifactId: ID, versionId: 1 })) as { bytes: unknown };
    expect(state.bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(state.bytes as Uint8Array).equals(Buffer.from(STATE))).toBe(true);
    expect(validateCommandOutput('artifacts.versionState', state)).toMatchObject({ ok: true }); // the renderer's schema reads it

    const asset = new Uint8Array(randomBytes(64 * 1024));
    l.host.handlers.set('artifacts.uploadAsset', () => ({ assetId: '0b1c2d3e-4f50-4617-8899-aabbccddeeff', ref: 'assets/logo.png' }));
    expect(await l.a.cmd('artifacts.uploadAsset', { artifactId: ID, name: 'logo.png', mime: 'image/png', bytes: asset })).toEqual({ assetId: '0b1c2d3e-4f50-4617-8899-aabbccddeeff', ref: 'assets/logo.png' });
    const [run] = l.host.artifactRuns.filter((r) => r.name === 'artifacts.uploadAsset');
    expect((run!.input as { bytes: unknown }).bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from((run!.input as { bytes: Uint8Array }).bytes).equals(Buffer.from(asset))).toBe(true);
  });

  it('refuses both locally `not-offered` against an endpoint that lists no `rl2.bytes`, sending neither', async () => {
    endpointWithout('rl2.bytes');
    const l = await lab();
    l.host.artifact(ID, ['app-1']);
    l.host.reads.set('artifacts.versionState', () => ({ bytes: STATE }));
    l.host.handlers.set('artifacts.uploadAsset', () => ({ assetId: '0b1c2d3e-4f50-4617-8899-aabbccddeeff', ref: 'assets/logo.png' }));
    expect(l.a.link.peerCapabilities()).not.toContain('rl2.bytes');
    expect(await l.a.route('artifacts.versionState', { artifactId: ID, versionId: 1 })).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'not-offered' } } });
    expect(await l.a.route('artifacts.uploadAsset', { artifactId: ID, name: 'logo.png', mime: 'image/png', bytes: new Uint8Array(randomBytes(64 * 1024)) })).toMatchObject({ ok: false, error: { code: 'internal', issues: { refusal: 'not-offered' } } });
    expect(l.host.calls.filter((c) => c.name === 'artifacts.versionState' || c.name === 'host.artifactOp')).toEqual([]);
    expect(l.host.artifactRuns).toEqual([]);
  });
});

// ---- P5 O7 M5b: pages and documents across machines ----------------------------------------------------------------------

// M5b's "Proves" for this file: a remote session's page fetched through the real endpoint, over a scratch store under the
// fake services (the artifact endpoint's own library: its headers, its ranges, the bridge script), and served to a
// `Request` through main's real chain; a document behind the endpoint's document channels (a real Yjs host speaking A's
// frames) edited from two devices, across a forced drop, and opened read-only by a member who holds `view` until the share
// is withdrawn. Each device's document bridge is main's own (src/main/artifacts/remote-open.ts), its window's replica the
// real port provider on the port the bridge posts, reopened as the ArtifactHost reopens it.
const PAGE_ID = '3c4d5e6f-7a8b-4c9d-8eaf-b1c2d3e4f506';
const DOC_ID = '4d5e6f7a-8b9c-4dae-9fb0-c2d3e4f50617';
const PAGE = '<!doctype html><html><head><title>Report</title></head><body><h1>Report from the mini</h1></body></html>';
const pageUrl = (id: string, path = 'index.html') => `maws-artifact://${id}/live/${path}`;
const text = (doc: Doc) => doc.get('root').toString();

/**
 * Main's chain as `startArtifacts` installs it, the device's remote responder in it (as app.ts passes it); `local` is
 * each read of this Mac's engine host, which has no artifact of the machine's.
 */
function mainChain(d: Device): { fetch(request: Request): Promise<Response>; local: string[] } {
  const local: string[] = [];
  const root = mkdtempSync(join(tmpdir(), 'maws-o7-scheme-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const hosts = {
    dispatch: async (_owner: string, name: string, input: { artifactId?: string }) => (local.push(`${name} ${input?.artifactId}`), { ok: false, error: { code: 'invalid_input', message: 'no such artifact' } }),
    postDocPort: () => false,
    closeDocPorts: () => {},
    onState: () => () => {},
    onStreaming: () => () => {},
    onEvent: () => () => {},
    peer: () => null,
  };
  const noop = (() => {}) as never;
  const started = startArtifacts({ hosts: hosts as unknown as ArtifactsDeps['hosts'], register: noop, registerMachine: noop, emit: noop, env: {}, openWindow: noop, root, artifactsSocket: '/tmp/artifacts.sock', remote: d.adapter.artifacts.scheme });
  cleanups.push(() => started.stop());
  const handler = schemes.handlers.at(-1)!;
  return { fetch: (request) => handler(request), local };
}

/**
 * The machine's document host behind the endpoint's document channels (as `mawsd` relays them to the engine host), over
 * the fake host port (`fakeDocuments`, which keeps each channel's open, the frames the endpoint wrote and its end): one
 * Yjs doc per artifact, speaking A's frames to each channel as the engine host's document service does as far as a
 * replica can observe (src/artifacts/document/editor/memory-host.ts's rules): step 1 at the open, a step 2 for a step 1,
 * each content frame applied and acked by the channel's count, what lands sent to the other channels, awareness relayed.
 * Each answer goes a turn later, as over the host's socket. Installed before the endpoint starts.
 */
function documentHost(services: FakeServices) {
  const port = fakeDocuments(services);
  type Held = { doc: Doc; revision: number; channels: Map<number, number> /* the content frames each channel sent */ };
  const held = new Map<string, Held>();
  const artifactOf = new Map<number, string>();
  const send = (channel: number, frame: Frame) => queueMicrotask(() => port.send(channel, encodeFrame(frame)));
  const heldOf = (artifactId: string): Held => {
    const existing = held.get(artifactId);
    if (existing !== undefined) return existing;
    const made: Held = { doc: newDoc(), revision: 0, channels: new Map() };
    cleanups.push(onUpdate(made.doc, (update, origin) => {
      made.revision += 1;
      for (const channel of made.channels.keys()) if (channel !== origin) send(channel, { type: 'update', update, seq: made.revision });
    }));
    held.set(artifactId, made);
    return made;
  };
  const receive = (channel: number, frame: Frame) => {
    const artifact = heldOf(artifactOf.get(channel)!);
    if (!artifact.channels.has(channel)) return; // closed meanwhile
    if (frame.type === 'step1') return send(channel, { type: 'step2', update: diffV1(artifact.doc, frame.sv), revision: artifact.revision });
    if (frame.type === 'awareness') return void [...artifact.channels.keys()].filter((c) => c !== channel).forEach((c) => send(c, frame));
    if (frame.type !== 'step2' && frame.type !== 'update') return;
    applyV1(artifact.doc, frame.update, channel);
    artifact.channels.set(channel, artifact.channels.get(channel)! + 1);
    send(channel, { type: 'ack', frames: artifact.channels.get(channel)!, revision: artifact.revision });
  };
  const { open, close, frame } = services.documents;
  services.documents = {
    ...services.documents,
    open(message) {
      if (!open(message)) return false;
      artifactOf.set(message.channel, message.artifactId);
      const artifact = heldOf(message.artifactId);
      artifact.channels.set(message.channel, 0);
      send(message.channel, { type: 'step1', sv: stateVector(artifact.doc) });
      return true;
    },
    close(channel) {
      close(channel);
      heldOf(artifactOf.get(channel)!).channels.delete(channel);
    },
    frame(channel, bytes) {
      if (!frame(channel, bytes)) return false;
      const decoded = decodeFrame(bytes);
      queueMicrotask(() => receive(channel, decoded));
      return true;
    },
  };
  return {
    port,
    /** The machine's document, as its store holds it. */
    doc: (artifactId: string) => heldOf(artifactId).doc,
    /** A write made on the machine. */
    write: (artifactId: string, value: string) => transact(heldOf(artifactId).doc, () => heldOf(artifactId).doc.get('root').insert(0, value)),
    /** The frame types the endpoint wrote to a channel (what reached the host from the device). */
    heard: (channel: number) => port.channels.get(channel)!.received.map((bytes) => decodeFrame(bytes).type),
  };
}

/** The machine's endpoint with a document host behind it, a session of its owners' and a document linked to it. */
async function documentLab(options: LabOptions = {}) {
  const services = fakeServices();
  const docs = documentHost(services);
  const l = await lab({ ...options, endpoint: { ...options.endpoint, services } });
  l.host.add('app-1');
  l.place('app-1');
  l.host.artifact(DOC_ID, ['app-1']); // a document
  return { l, docs };
}

// A window's webContents as the bridge reaches it through its ClientRef (src/main/ipc/clients.ts).
let windows = 1;
const fakeWindow = () => Object.assign(new EventEmitter(), { id: windows++, postMessage: vi.fn(), isDestroyed: () => false });

/** A window's replica of a document: the real port provider, on the ports main posts that window. */
function replica() {
  const doc = newDoc();
  const provider = new PortProvider(doc, { log: () => {} });
  cleanups.push(() => provider.destroy());
  const window = fakeWindow();
  return { doc, provider, window, client: clientOf(window as never) };
}
type Replica = ReturnType<typeof replica>;

/**
 * `artifacts.open` from the replica's window, as the ArtifactHost asks it (its first open and every reopen), the port main
 * posts for the answer's channel connected to the replica's provider, and the replica synced with the machine.
 */
async function openOn(d: Device, r: Replica, artifactId = DOC_ID): Promise<{ readOnly: boolean; port: End }> {
  const answer = await d.route('artifacts.open', { artifactId }, { client: r.client });
  if (!answer.ok) throw new Error(`artifacts.open: ${answer.error.code} ${answer.error.message}`);
  const { channel, readOnly } = answer.value as { channel: number; readOnly?: true };
  const posted = r.window.postMessage.mock.calls.find((call) => call[0] === DOC_PORT_CHANNEL && (call[1] as { channel: number }).channel === channel);
  expect(posted?.[1]).toEqual({ channel, artifactId });
  const port = (posted![2] as End[])[0]!;
  r.provider.connect(port);
  await until(() => r.provider.state.phase === 'live' && r.provider.state.synced, `${d.id}'s replica synced`);
  return { readOnly: readOnly === true, port };
}

describe('pages and documents across machines (P5 O7 M5b)', { timeout: 30_000 }, () => {
  it('serves a remote session’s page to a Request through main’s chain, from the machine’s store over the real endpoint as the machine’s scheme answers it, and its asset by range', async () => {
    const l = await lab();
    const store = scratchArtifacts(l.f.services);
    l.host.add('app-1');
    l.place('app-1');
    const row = l.host.artifact(PAGE_ID, ['app-1'], { kind: 'html', title: 'Report' });
    l.host.reads.set('artifacts.list', () => ({ artifacts: [row] }));
    store.put(PAGE_ID, 'index.html', PAGE);
    const clip = new Uint8Array(randomBytes(300 * 1024));
    store.put(PAGE_ID, 'assets/clip.mp4', clip);
    const chain = mainChain(l.a);
    expect(await l.a.cmd('artifacts.list', { filter: { appSessionId: 'app-1' } })).toEqual({ artifacts: [row] }); // the pane's list: the artifact is the mini's

    const page = await chain.fetch(new Request(pageUrl(PAGE_ID)));
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('content-security-policy')).toBeTruthy(); // the frame's, as the machine's scheme sets it
    expect(await page.text()).toBe(PAGE.replace('<head>', `<head><script data-maws-bridge>${BRIDGE_SCRIPT}</script>`)); // bridged on the machine

    const range = await chain.fetch(new Request(pageUrl(PAGE_ID, 'assets/clip.mp4'), { headers: { range: 'bytes=1000-1999' } }));
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe(`bytes 1000-1999/${clip.byteLength}`);
    expect(Buffer.from(await range.arrayBuffer()).equals(Buffer.from(clip.subarray(1000, 2000)))).toBe(true);
    expect(store.fetches()).toBe(2); // both from the machine's store
    expect(chain.local).toEqual([]); // never this Mac's
  });

  it('lets a paused media body give its slot to a later load once it has idled 2 s, the page then served whole, the media resumed by range', async () => {
    const l = await lab();
    const store = scratchArtifacts(l.f.services);
    l.host.add('app-1');
    l.place('app-1');
    const row = l.host.artifact(PAGE_ID, ['app-1'], { kind: 'html', title: 'Report' });
    l.host.reads.set('artifacts.list', () => ({ artifacts: [row] }));
    store.put(PAGE_ID, 'index.html', PAGE);
    const clip = new Uint8Array(randomBytes(3 * MiB));
    store.put(PAGE_ID, 'assets/clip.mp4', clip);
    const chain = mainChain(l.a);
    await l.a.cmd('artifacts.list', { filter: { appSessionId: 'app-1' } });

    // eight media panes paused after their answer: every slot of the link held by a body nobody reads
    const paused = await Promise.all(Array.from({ length: 8 }, () => chain.fetch(new Request(pageUrl(PAGE_ID, 'assets/clip.mp4')))));
    expect(paused.map((r) => r.status)).toEqual(Array(8).fill(200));
    const asked = Date.now();
    const page = await chain.fetch(new Request(pageUrl(PAGE_ID)));
    expect(Date.now() - asked).toBeGreaterThanOrEqual(1_500); // it waited for one to idle 2 s, not for the 30 s bound
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Report from the mini');

    // one gave way, ending normally with what had come; the others kept theirs and read on whole
    const bodies = await Promise.all(paused.map(async (r) => Buffer.from(await r.arrayBuffer())));
    const cut = bodies.filter((body) => body.byteLength < clip.byteLength);
    expect(cut).toHaveLength(1);
    expect(cut[0]!.equals(Buffer.from(clip.subarray(0, cut[0]!.byteLength)))).toBe(true);
    for (const body of bodies.filter((b) => b !== cut[0])) expect(body.equals(Buffer.from(clip))).toBe(true);
    // played on, the element asks from where it stopped
    const resumed = await chain.fetch(new Request(pageUrl(PAGE_ID, 'assets/clip.mp4'), { headers: { range: `bytes=${cut[0]!.byteLength}-` } }));
    expect(resumed.status).toBe(206);
    expect(Buffer.from(await resumed.arrayBuffer()).equals(Buffer.from(clip.subarray(cut[0]!.byteLength)))).toBe(true);
  });

  it('converges a document edited from two devices: each one’s typing in the machine’s store and in the other’s replica, every edit acked', async () => {
    const { l, docs } = await documentLab();
    docs.write(DOC_ID, 'base');
    const other = await l.device('mac2');
    const [one, two] = [replica(), replica()];
    expect((await openOn(l.a, one)).readOnly).toBe(false);
    expect((await openOn(other, two)).readOnly).toBe(false);
    expect([text(one.doc), text(two.doc)]).toEqual(['base', 'base']);
    expect([...docs.port.channels.values()].map((c) => c.open)).toEqual([expect.objectContaining({ artifactId: DOC_ID, actor: { kind: 'human' } }), expect.objectContaining({ artifactId: DOC_ID, actor: { kind: 'human' } })]);

    one.doc.get('root').insert(4, ' from mac1');
    two.doc.get('root').insert(0, 'mac2: ');
    await until(() => one.provider.state.unsaved === 0 && two.provider.state.unsaved === 0 && text(one.doc) === text(docs.doc(DOC_ID)) && text(two.doc) === text(docs.doc(DOC_ID)), 'both devices and the store converged', 10_000);
    expect(text(docs.doc(DOC_ID))).toBe('mac2: base from mac1');
  });

  it('lands an edit made across a forced drop: one in flight when the carrier goes (its ack lost) and one typed while the link is down, each in the store once after the reopen', async () => {
    const { l, docs } = await documentLab({ link: { UP_GRACE_MS: 100, BACKOFF_MS: [0, 100, 100] } });
    docs.write(DOC_ID, 'base');
    const r = replica();
    const first = await openOn(l.a, r);
    const { carrier, tap } = l.a.carriers.at(-1)!;
    tap.mute = true; // what the machine says from now on is lost, the edit's ack among it
    r.doc.get('root').insert(4, ' typed');
    await until(() => text(docs.doc(DOC_ID)) === 'base typed', 'the edit in the machine’s store');
    await sleep(50);
    expect(r.provider.state.unsaved).toBe(1); // never acked

    l.a.direct.dead = true;
    carrier.close('dropped');
    await until(() => first.port.closed, 'the window’s port closed with its stream');
    expect(r.provider.state).toMatchObject({ phase: 'off', unsaved: 1 });
    await until(() => l.a.link.state() === 'down', 'the link down');
    r.doc.get('root').insert(10, ' offline'); // typed while the machine can't hear it
    expect(await l.a.route('artifacts.open', { artifactId: DOC_ID }, { client: r.client })).toMatchObject({ ok: false, error: { code: 'host_unavailable', message: 'mini is offline' } });

    l.a.direct.dead = false;
    l.a.link.probe('network');
    await until(() => l.a.link.state() === 'up', 'the link up again', 10_000);
    await openOn(l.a, r); // the ArtifactHost's reopen: a fresh port and stream, the same provider
    await until(() => r.provider.state.unsaved === 0, 'every edit acked', 10_000);
    expect(text(docs.doc(DOC_ID))).toBe('base typed offline'); // each once
    expect(text(r.doc)).toBe('base typed offline');
  });

  it('opens a document read-only for a member who holds `view`, whose writes never reach the store while presence does, and closes it `removed` when the share is withdrawn mid-stream', async () => {
    const { l, docs } = await documentLab();
    l.f.records.set({ lane: 'B', session: 'eng-app-1', owners: ['@machine'], shares: [{ member: org.B, grade: 'view' }] }, 'app-1');
    docs.write(DOC_ID, 'shared text');
    const owner = replica();
    await openOn(l.a, owner);
    const b = await l.device('mac-b', { member: 'B' });
    const member = replica();
    const opened = await openOn(b, member);
    expect(opened.readOnly).toBe(true); // `edit` refused `grade`, `view` admitted
    expect(text(member.doc)).toBe('shared text');
    const channel = docs.port.last().channel;
    expect(docs.port.last().open).toMatchObject({ artifactId: DOC_ID, actor: { kind: 'human' } });

    member.doc.get('root').insert(0, 'B wrote ');
    member.provider.awareness.setLocalStateField('user', { name: 'B' }); // after the write, on the same stream
    await until(() => owner.provider.awareness.getStates().get(member.doc.clientID) !== undefined, 'B’s presence at the owner’s replica');
    expect(text(docs.doc(DOC_ID))).toBe('shared text');
    expect(text(owner.doc)).toBe('shared text');
    expect(new Set(docs.heard(channel))).toEqual(new Set(['step1', 'awareness'])); // nothing else reached the host

    l.f.records.set({ lane: 'B', session: 'eng-app-1', owners: ['@machine'] }, 'app-1'); // withdrawn, no `caps` refresh
    await until(() => opened.port.closed, 'B’s port closed with its stream');
    await until(() => b.logs.some((line) => line.startsWith(`documents: ${DOC_ID} on mini ended (removed)`)), 'the stream closed `removed`');
    expect(docs.port.channels.get(channel)!.ended).toBe('endpoint');
    expect(await b.route('artifacts.open', { artifactId: DOC_ID }, { client: member.client })).toMatchObject({ ok: false, error: { code: 'invalid_input', issues: { reason: 'notFound' } } }); // for good

    owner.doc.get('root').insert(11, ', still the owner’s'); // the owner's stream untouched
    await until(() => owner.provider.state.unsaved === 0 && text(docs.doc(DOC_ID)) === 'shared text, still the owner’s', 'the owner’s edit landed');
  });
});

// ---- P5 O7 M5c: O4's surfaces across machines ----------------------------------------------------------------------------

// M5c's "Proves" for this file: O4's surfaces on another machine through the real link and the real endpoint, over the
// machine's connectors as the spine's root composes them (`composeConnectors`) on the endpoint's spine, route E over the
// connector suite's scripted engine host (test/support/fake-connector-host.ts) and, where a case needs it, a fake route D
// beside it. A dashboard's lease refreshes while its window is shown and is held while hidden; a forced carrier drop
// rebuilds that machine's leases under new ids after its reset, the local machine's untouched; the local machine host's
// own reconnect names the local machine, the remote lease left as it was; a lease command in flight at a drop answers
// `host_unavailable`, never `grade`, and nothing of it reaches the next channel; a Connect completes through the device's
// own loopback listener, relayed to the machine, sealing the grant there; Send to runs on the machine's delivery.
const LIVE = CONNECTOR_ART; // the dashboard: an HTML artifact of a session of the machine's owners, its lease's artifact
const ROWS = { server: 'fixture', tool: 'rows' };
const AS = 'https://auth.example.com';
const NOTES: DirectSource = { directory: '/repo', sourceId: '22222222-2222-4222-8222-222222222222', generation: 1, server: 'notes', scope: 'user', transport: 'http', path: '/h/.claude.json', entryPath: ['mcpServers', 'notes'], observedAt: '2026-11-02T00:00:00.000Z', resourceUrl: 'https://notes.example.com/mcp' };
const NOTION: DirectSource = { directory: '/repo', sourceId: '44444444-4444-4444-8444-444444444444', generation: 1, server: 'notion', scope: 'user', transport: 'stdio', path: '/h/.claude.json', entryPath: ['mcpServers', 'notion'], observedAt: '2026-11-02T00:00:00.000Z' };
const NOTION_PAGE = { content: [{ type: 'text', text: JSON.stringify({ pages: [{ id: 'abc', url: 'https://www.notion.so/Live-0123456789abcdef0123456789abcdef', properties: { title: 'Live' } }] }) }] };

/** The connector service's view of the machine's index: the dashboard's creator and its project, as its own suite holds them. */
const connectorView = () => fakeSpineView({ records: [record('app-own', { projectId: 'proj' as never, directory: '/repo' })], projects: [project('proj', 0, { directory: '/repo' })] });

/**
 * A fake route D (route D's host leg stands in): the owner's sources by name, their discovery answered as an OAuth
 * server answers it (refused until MAWS's own sign-in is saved; a stdio source needs none), Send to's tool located among
 * them and run once, never a lease's route.
 */
function fakeRouteD(provider: () => ConnectorOAuthProvider | null) {
  const sent: Array<{ source: DirectSource; request: { artifactId: string; tool: string; arguments: Record<string, unknown> } }> = [];
  const route: DirectRoute = {
    route: 'direct',
    resolve: async () => null,
    operationEnded: () => {},
    reconcile: () => {},
    hostLost: () => {},
    stop: () => {},
    close: async () => ({ ok: true, cancelled: 0 }),
    resolveSource: async (_artifactId, server) => {
      const source = [NOTES, NOTION].find((candidate) => candidate.server === server);
      return source ? { ok: true, source, tool: { fingerprint: CONNECTOR_FP, readOnly: true } } : { ok: false, why: 'unobserved' };
    },
    discover: async (source) => {
      const identity = oauthIdentityOf(source);
      const connected = source.transport === 'stdio' || (identity !== null && (await provider()?.state(identity))?.state === 'connected');
      return connected ? { ok: true, tools: [{ name: 'search', readOnly: true }] } : { ok: false, failure: 'unavailable', reason: 'unauthorized' };
    },
    locate: async (tool) => (tool === 'notion-create-pages' ? [NOTION] : []),
    send: async (source, request) => {
      sent.push({ source, request });
      return { ok: true, result: NOTION_PAGE };
    },
  };
  return { route, sent };
}

// The OAuth server and the protected resource of NOTES, as the flow's own suites script them (oauth-flow.test.ts)
const jsonAnswer = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
function oauthServers(real: typeof fetch) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.origin === 'https://notes.example.com' && url.pathname.startsWith('/.well-known/oauth-protected-resource')) return jsonAnswer({ resource: url.origin, authorization_servers: [AS] });
    if (url.origin === AS && url.pathname === '/.well-known/oauth-authorization-server') {
      return jsonAnswer({
        issuer: AS, authorization_endpoint: `${AS}/authorize`, token_endpoint: `${AS}/token`, registration_endpoint: `${AS}/register`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }
    if (url.origin === AS && url.pathname === '/register') {
      const sent = JSON.parse(String(init?.body)) as { redirect_uris: string[] };
      return jsonAnswer({ client_id: 'client-1', redirect_uris: sent.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'MAWS' });
    }
    if (url.origin === AS && url.pathname === '/token') return jsonAnswer({ access_token: 'at-1', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt-1' });
    if (url.hostname === '127.0.0.1') return real(input, init);
    return new Response('not found', { status: 404 });
  };
}

type MachineConnectorsOptions = { routeD?: true; front?: ServicesFront; delivery?: true };
/**
 * The machine's connectors on the endpoint's spine, as the spine's root composes them: every command the spine ran, with
 * the ref it ran under (`ran`), any of them held at the machine until released (`hold`); the bus's events the machine's
 * own (`emitMachine`), as `mawsd`'s front sends the spine's. With `routeD`, the fake route D and MAWS's own OAuth over a
 * scratch key file beside route E (the machine's loopback never bound: its `listen` throws); with `delivery`, Send to's
 * service over the connectors' owner delivery, the library's Export a file planted as the root's export leaves it.
 */
function machineConnectors(l: Lab, options: MachineConnectorsOptions = {}) {
  const host = new FakeConnectorHost();
  host.grants.set(JSON.stringify([ROWS.server, ROWS.tool]), 'read');
  host.endAtStart = true; // each operation ends as it starts: a refresh publishes at once
  const ran: Array<{ name: string; input: Record<string, unknown>; client: ClientRef }> = [];
  const gates = new Map<string, Promise<void>>();
  const bus = {
    register: (name: string, handler: (input: never, context: HandlerContext) => unknown) =>
      l.f.spine.handle(name, async (input, context) => {
        ran.push({ name, input: input as Record<string, unknown>, client: context.client });
        await gates.get(name);
        return handler(input as never, context);
      }),
    emit: (name: EventName, payload: unknown) => {
      if (!validateEventPayload(name, payload).ok) return false;
      l.f.host.emitMachine(name, payload);
      return true;
    },
  };
  // the engine host's reads the scripted host has no answer for: the delivery's title and its observation of a live session
  const dispatch = (owner: string, name: CommandName, input: unknown) => {
    if (name === 'artifacts.get') return Promise.resolve({ ok: true as const, value: { artifact: host.artifact } });
    if (name === 'connectors.observe') return Promise.resolve({ ok: true as const, value: { observed: true } });
    return host.dispatch(owner, name, input);
  };
  const port = options.front?.port ?? { openExternal: async () => ({ opened: false as const, reason: 'no client port here' }) };
  const root = mkdtempSync(join(tmpdir(), 'maws-o7-connectors-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'connectors', 'oauth');
  let provider: ConnectorOAuthProvider | null = null;
  const d = fakeRouteD(() => provider);
  const part = composeConnectors({
    hosts: { dispatch: dispatch as never, onEvent: host.onEvent as never, onState: host.onState as never, onStreaming: host.onStreaming as never, streaming: host.streaming as never },
    bus: bus as never,
    view: connectorView(),
    realpath: (path) => path,
    port,
    log: () => {},
    ...(options.routeD && {
      direct: () => d.route,
      oauth: (own) =>
        (provider = productionConnectorOAuth({
          ...own,
          custody: fileKeyCustody(directory, { excludeFromBackup: async () => true }),
          directory,
          listen: async () => {
            throw new Error('a remote asker’s consent bound the machine’s loopback');
          },
        })),
    }),
  });
  cleanups.push(() => part.stop());
  const artifactsRoot = realpathSync(mkdtempSync(join(tmpdir(), 'maws-o7-exports-')));
  cleanups.push(() => rmSync(artifactsRoot, { recursive: true, force: true }));
  const exported: string[] = [];
  if (options.delivery) {
    const delivery = startDelivery({
      bus: bus as never,
      hosts: { dispatch: dispatch as never },
      connectors: part.delivery,
      shellEnv: async () => ({}),
      port,
      artifactsRoot,
      exportArtifact: async (input) => {
        const exports = join(artifactsRoot, input.artifactId, 'exports');
        mkdirSync(exports, { recursive: true });
        const exportId = randomUUID();
        const path = join(exports, artifactExportName(1, input.format, exportId));
        writeFileSync(path, '# Live\n\nRows from the mini.\n');
        exported.push(path);
        return { ok: true, value: { path, revision: 1, exportId } };
      },
      log: () => {},
    });
    cleanups.push(() => delivery.stop());
  }
  return {
    host,
    ran,
    sent: d.sent,
    exported,
    /** The machine's sealed grants (MAWS's own OAuth's records). */
    sealed: () => (existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith('.sealed')) : []),
    /** Each command of `name` the spine ran from now on waits at the machine until the release. */
    hold(name: string): () => void {
      let release!: () => void;
      gates.set(name, new Promise<void>((resolve) => (release = resolve)));
      return () => (gates.delete(name), release());
    },
    /** The window reports the machine took, in order. */
    shown: () => ran.filter((r) => r.name === 'connectors.windowShown').map((r) => r.input.shown),
    named: (name: string) => ran.filter((r) => r.name === name),
  };
}

/** The endpoint with a session of its owners' and the dashboard linked to it, the machine's connectors on its spine. */
async function leaseLab(options: LabOptions & MachineConnectorsOptions = {}) {
  const l = await lab(options);
  l.host.add('app-1');
  l.place('app-1');
  l.host.artifact(LIVE, ['app-1'], { kind: 'html', title: 'Live' });
  const m = machineConnectors(l, options);
  l.a.roster(); // the machine's gate and its artifacts feed, on the roster's link
  await until(() => resets(l.a).length === 1, 'the machine’s first reset', 10_000);
  return { l, m };
}

const resets = (d: Device) => d.own.filter((e) => e.name === 'connectors.reset').map((e) => e.payload);
type Watching = { leaseId: string; watchId: string };
/** A page's watching lease, as the renderer's connectors client makes one: the lease, its declaration, shown, and a watch. */
async function watching(d: Device, client: EndableClientRef): Promise<Watching> {
  const { leaseId } = (await d.cmd('connectors.open', { artifactId: LIVE }, { client })) as { leaseId: string };
  expect(await d.cmd('connectors.declare', { leaseId, tools: [ROWS] }, { client })).toMatchObject({ ok: true });
  expect(await d.cmd('connectors.visibility', { leaseId, visible: true }, { client })).toEqual({ ok: true });
  const watch = (await d.cmd('connectors.watch', { leaseId, request: { ...ROWS, intervalMs: 30_000 } }, { client })) as { ok: true; watchId: string };
  expect(watch).toMatchObject({ ok: true });
  return { leaseId, watchId: watch.watchId };
}
const updatesOf = (d: Device, w: Watching) => d.emitted.filter((e) => e.name === 'connectors.watchUpdate' && e.payload.leaseId === w.leaseId && e.payload.watchId === w.watchId).map((e) => e.payload.update);

/** One GET of the device's consent listener, as the browser makes it after the redirect: its status and body. */
function browse(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, { agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error(`GET ${url} timed out`)));
  });
}

describe('O4’s surfaces across machines (P5 O7 M5c)', { timeout: 30_000 }, () => {
  it('refreshes a dashboard’s watch on the machine while its window is shown, and holds the lease while it is hidden', async () => {
    const { l, m } = await leaseLab();
    const { client, window } = l.a.page('page-dash');
    const lease = await watching(l.a, client);
    await until(() => updatesOf(l.a, lease).length === 1, 'the watch’s first refresh, said from the machine');
    expect(updatesOf(l.a, lease)[0]).toEqual({ ok: true, result: { content: 'rows 107' }, fetchedAt: expect.any(Number), via: { route: 'engine' } }); // its session withheld
    expect(m.shown()).toEqual([true]); // one report for the device, made before the page's first lease command
    expect(m.named('connectors.windowShown')[0]!.client).toBe(m.named('connectors.open')[0]!.client); // under the channel's one ref
    expect(await l.a.cmd('connectors.refresh', lease, { client })).toEqual({ refreshing: true });
    await until(() => updatesOf(l.a, lease).length === 2, 'the page’s refresh');

    window.set(false);
    await until(() => m.shown().at(-1) === false, 'the hidden window reported to the machine');
    const ran = m.host.started().length;
    expect(await l.a.cmd('connectors.refresh', lease, { client })).toEqual({ refreshing: false });
    expect(await l.a.cmd('connectors.call', { leaseId: lease.leaseId, request: ROWS }, { client })).toEqual({ ok: false, state: 'paused', reason: 'hidden' });
    await sleep(200);
    expect(m.host.started()).toHaveLength(ran); // nothing runs on the machine while the window is hidden
    expect(updatesOf(l.a, lease)).toHaveLength(2);

    window.set(true);
    await until(() => m.shown().at(-1) === true, 'the window shown again, reported');
    expect(await l.a.cmd('connectors.refresh', lease, { client })).toEqual({ refreshing: true }); // the same lease and watch
    await until(() => updatesOf(l.a, lease).length === 3, 'a refresh once shown again');
    expect(m.named('connectors.open')).toHaveLength(1);
    expect(m.named('connectors.close')).toEqual([]); // held while hidden, never closed
  });

  it('rebuilds a machine’s watch under new ids after a forced carrier drop: the next channel reports the window, then that machine’s reset; the local machine’s leases are untouched', async () => {
    const { l, m } = await leaseLab({ link: { UP_GRACE_MS: 100, BACKOFF_MS: [0, 100, 100] } });
    // this Mac's own connectors (its mawsd's), a page of its own watching there
    const localHost = new FakeConnectorHost();
    localHost.grants.set(JSON.stringify([ROWS.server, ROWS.tool]), 'read');
    localHost.endAtStart = true;
    const localBus = fakeBus();
    const local = composeConnectors({ hosts: { dispatch: localHost.dispatch as never, onEvent: localHost.onEvent as never, onState: localHost.onState as never, onStreaming: localHost.onStreaming as never, streaming: localHost.streaming as never }, bus: localBus, view: connectorView(), realpath: (path) => path, port: { openExternal: async () => ({ opened: false as const, reason: 'none' }) }, log: () => {} });
    cleanups.push(() => local.stop());
    const localPage = endableClientRef('page-local');
    cleanups.push(() => localPage.end());
    const localCmd = async (name: CommandName, input: unknown) => {
      const answer = await localBus.main(name, input, localPage);
      if (!answer.ok) throw new Error(`${name}: ${answer.error.message}`);
      return answer.value as Record<string, unknown>;
    };
    await localCmd('connectors.windowShown', { shown: true });
    const localLease = (await localCmd('connectors.open', { artifactId: LIVE })).leaseId as string;
    await localCmd('connectors.declare', { leaseId: localLease, tools: [ROWS] });
    await localCmd('connectors.visibility', { leaseId: localLease, visible: true });
    const localWatch = (await localCmd('connectors.watch', { leaseId: localLease, request: { ...ROWS, intervalMs: 30_000 } })).watchId as string;
    const localUpdates = () => localBus.emittedOf('connectors.watchUpdate').filter((u) => u.leaseId === localLease && u.watchId === localWatch);
    await until(() => localUpdates().length === 1, 'the local watch’s first refresh');

    const { client } = l.a.page('page-dash');
    const first = await watching(l.a, client);
    await until(() => updatesOf(l.a, first).length === 1, 'the remote watch’s first refresh');
    const firstRef = m.named('connectors.open')[0]!.client;
    const localAsked = localHost.dispatched.length;

    const before = l.a.link.peerCapabilities();
    l.a.carriers.at(-1)!.carrier.close('dropped');
    await onNewChannel(l.a, before);
    await until(() => resets(l.a).length === 2, 'the machine’s reset on its next channel', 10_000);
    expect(resets(l.a)).toEqual([{ machine: l.f.ref }, { machine: l.f.ref }]); // that machine alone, never the local one
    let gone = false;
    firstRef.onGone(() => (gone = true)); // at once for a ref that has ended
    expect(gone).toBe(true); // the old channel's ref ended, and the machine closed its leases with it

    const rebuilt = await watching(l.a, client); // the renderer's rebuild of that machine's surfaces
    expect(rebuilt.leaseId).not.toBe(first.leaseId);
    expect(rebuilt.watchId).not.toBe(first.watchId);
    await until(() => updatesOf(l.a, rebuilt).length === 1, 'the watch resumed under its new ids');
    // the next channel took the window's report under its own ref before the rebuild's first lease command
    const reopened = m.ran.findIndex((r) => r.name === 'connectors.open' && r.client !== firstRef);
    const reported = m.ran.findIndex((r) => r.name === 'connectors.windowShown' && r.client !== firstRef);
    expect(m.ran[reported]!.input).toEqual({ shown: true });
    expect(m.ran[reported]!.client).toBe(m.ran[reopened]!.client);
    expect(reported).toBeLessThan(reopened);
    expect(m.shown()).toEqual([true, true]); // one report per channel for the device
    expect(updatesOf(l.a, first)).toHaveLength(1); // the old watch ended with its channel
    expect(await l.a.route('connectors.refresh', first, { client })).toMatchObject({ ok: false, error: { issues: { refusal: 'grade' } } }); // its lease is nobody's now

    // the local machine's lease and watch, as they were: nothing reached it, and it refreshes under its own ids
    expect(localHost.dispatched).toHaveLength(localAsked);
    expect(await localCmd('connectors.refresh', { leaseId: localLease, watchId: localWatch })).toEqual({ refreshing: true });
    await until(() => localUpdates().length === 2, 'the local watch refreshing still');
  });

  it('leaves a remote dashboard’s lease and watch as they were when the local machine host reconnects: its reset names the local machine', async () => {
    const { l, m } = await leaseLab();
    // main's own connectors for this Mac (src/main/connectors/index.ts): the machine host's streaming after the first
    // says this Mac's reset, to the same windows as the remote lane's
    const streamings = new Set<() => void>();
    const app = startAppConnectors({
      local: LOCAL,
      machine: { streaming: () => true, onStreaming: (listener) => (streamings.add(listener), () => void streamings.delete(listener)) },
      windowShown: () => null,
      invoke: (async () => ({ ok: true, value: { ok: true } })) as never,
      before: () => () => {},
      emit: (name, payload) => void l.a.own.push({ name, payload: payload as Record<string, unknown> }),
      adopt: async () => ({ retry: false }),
      log: () => {},
    });
    cleanups.push(() => app.stop());
    const { client } = l.a.page('page-dash');
    const lease = await watching(l.a, client);
    await until(() => updatesOf(l.a, lease).length === 1, 'the remote watch’s first refresh');
    const channel = l.a.link.peerCapabilities();

    for (const listener of [...streamings]) listener(); // this Mac's mawsd restarted: its host streams again
    expect(resets(l.a)).toEqual([{ machine: l.f.ref }, { machine: LOCAL }]);
    await sleep(200);
    expect(resets(l.a)).toHaveLength(2); // no reset of the remote machine follows
    expect(l.a.link.peerCapabilities()).toBe(channel);
    // the remote lease and its watch stand: refreshed under the same ids, nothing opened, closed or reported again
    expect(await l.a.cmd('connectors.refresh', lease, { client })).toEqual({ refreshing: true });
    await until(() => updatesOf(l.a, lease).length === 2, 'the remote watch refreshing under its ids');
    expect(m.named('connectors.open')).toHaveLength(1);
    expect(m.named('connectors.close')).toEqual([]);
    expect(m.shown()).toEqual([true]);
  });

  it('answers a lease command in flight at a drop `host_unavailable`, never `grade`, and sends nothing of it on the next channel', async () => {
    const { l, m } = await leaseLab({ link: { UP_GRACE_MS: 100, BACKOFF_MS: [0, 100, 100] } });
    const { client } = l.a.page('page-dash');
    const lease = await watching(l.a, client);
    await until(() => updatesOf(l.a, lease).length === 1, 'the watch’s first refresh');
    const releases = [m.hold('connectors.declare'), m.hold('connectors.call')];
    const declaring = l.a.route('connectors.declare', { leaseId: lease.leaseId, tools: [ROWS] }, { client }); // a call
    const calling = l.a.route('connectors.call', { leaseId: lease.leaseId, request: ROWS }, { client }); // an act
    await until(() => m.named('connectors.declare').length === 2 && m.named('connectors.call').length === 1, 'both at the machine');

    const before = l.a.link.peerCapabilities();
    l.a.carriers.at(-1)!.carrier.close('dropped');
    const [declared, called] = await Promise.all([declaring, calling]);
    expect(declared).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(called).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    for (const release of releases) release(); // the machine answers them now, to a channel that has ended

    await onNewChannel(l.a, before);
    await until(() => resets(l.a).length === 2, 'the machine’s reset on its next channel', 10_000);
    await sleep(300);
    expect(m.named('connectors.declare')).toHaveLength(2); // the watch's own, then the one in flight: never again
    expect(m.named('connectors.call')).toHaveLength(1);
    expect(l.f.host.calls.filter((c) => c.name === 'machine.opQuery')).toEqual([]); // the act not asked after on the next channel
  });

  it('completes a Connect through the device’s own loopback listener, the consent’s redirect relayed to the machine, sealing the grant there', async () => {
    vi.stubGlobal('fetch', vi.fn(oauthServers(fetch)));
    cleanups.push(() => vi.unstubAllGlobals());
    // the machine's services front's client port (mawsd's), its targets the endpoint's channels
    const front = createServicesFront({
      spine: { ensure: async () => ({}) as never },
      hosts: { forward: async () => ({ t: 'res', id: 'x', ok: false, error: { code: 'host_unavailable', message: 'none' } }) as HostResponse, onRaw: () => () => {}, onStreaming: () => () => {}, parked: () => false },
      intercept: () => null,
      daemon: async () => undefined,
      identity: () => ({ ref: 'TestMachineRef00000000' as MachineRef, name: 'mini', project: { key: 'machine:TestMachineRef00000000', name: 'mini', smnsId: null } }),
      isApp: () => false,
      log: () => {},
    });
    cleanups.push(() => front.close());
    const services = fakeServices();
    services.clientPort = { serve: (ref, target) => front.serveRemote(ref, target) };
    const { l, m } = await leaseLab({ endpoint: { services }, routeD: true, front });
    const tools = [{ server: 'notes', tool: 'search' }];
    const notesRow = async () => {
      const { servers } = (await l.a.cmd('connectors.servers', { artifactId: LIVE, tools })) as { servers: Array<{ kind: string; server?: string; handle?: string } & Record<string, unknown>> };
      return servers.find((row) => row.kind === 'source' && row.server === 'notes')!;
    };
    const row = await notesRow();
    expect(await l.a.cmd('connectors.connect', { artifactId: LIVE, sourceHandle: row.handle })).toEqual({ accepted: true });
    await until(() => l.a.opened.length === 1, 'the consent opened on this device');
    const consent = new URL(l.a.opened[0]!);
    expect(consent.origin + consent.pathname).toBe(`${AS}/authorize`);
    const redirect = new URL(consent.searchParams.get('redirect_uri')!);
    expect([redirect.hostname, redirect.pathname]).toEqual(['127.0.0.1', '/callback']); // this device's listener
    const connect = m.named('connectors.connect')[0]!;
    expect(connect.input.callback).toEqual({ port: Number(redirect.port) });
    expect(m.sealed()).toEqual([]);

    // the browser lands on this device's loopback: a stray request first (the flow's own 404, the wait goes on), then the redirect
    expect(await browse(`${redirect.origin}/favicon.ico`)).toEqual({ status: 404, body: '' });
    expect(await browse(`${redirect.href}?code=c-1&state=${consent.searchParams.get('state')}`)).toEqual({ status: 200, body: 'MAWS is connected. You can close this window.' });
    expect(m.named('connectors.callback').map((r) => r.client)).toEqual([connect.client, connect.client]); // under the asking channel's ref
    await until(() => m.sealed().length === 1, 'the grant sealed on the machine');
    // the flow's end, heard on the artifacts feed, ends the listener
    await until(() => l.a.emitted.some((e) => e.name === 'connectors.serversChanged' && (e.payload.ended as { sourceHandle?: string } | undefined)?.sourceHandle === row.handle), 'the flow’s end on the feed');
    let closed = false;
    for (let tries = 0; tries < 50 && !closed; tries += 1) {
      closed = await browse(redirect.href).then(() => false, () => true);
      if (!closed) await sleep(50);
    }
    expect(closed).toBe(true);
    expect(await notesRow()).toMatchObject({ connection: { state: 'connected' }, last: { action: 'connect', ok: true, credential: 'maws' } });
  });

  it('sends an artifact of the machine to Notion through the machine’s delivery: exported there, one page made, the receipt said from the machine', async () => {
    const { l, m } = await leaseLab({ routeD: true, delivery: true });
    const status = (await l.a.cmd('delivery.status', { target: 'notion', artifactId: LIVE })) as { state: string; source?: { key: string; server: string } };
    expect(status).toMatchObject({ state: 'ready', source: { server: 'notion' } });
    const answer = await l.a.cmd('delivery.send', { runId: randomUUID(), target: 'notion', artifactId: LIVE, format: 'md', destination: { kind: 'default' }, source: status.source!.key });
    expect(answer).toMatchObject({ ok: true, receipt: { artifactId: LIVE, target: 'notion', name: 'Live', url: 'https://www.notion.so/Live-0123456789abcdef0123456789abcdef', format: 'md' } });
    expect(m.sent).toEqual([{ source: NOTION, request: { artifactId: LIVE, tool: 'notion-create-pages', arguments: expect.objectContaining({ pages: [{ properties: { title: 'Live' }, content: '# Live\n\nRows from the mini.\n' }] }) } }]);
    expect(m.named('delivery.send')).toHaveLength(1);
    expect(m.exported.every((path) => !existsSync(path))).toBe(true); // the export made on the machine, removed after the send
    await until(() => l.a.emitted.some((e) => e.name === 'delivery.receipt' && e.payload.artifactId === LIVE), 'the receipt from the machine');
    expect(l.a.confirmed).toEqual([]); // `manage`: no step-up
  });
});

// P5 O7 M5c round 3: a remote dashboard's snapshot holds, main's (src/main/dashboard/holds.ts) over the real link to the
// real endpoint (src/endpoint/asset-holds.ts), the machine's engine host's holds as the endpoint suite's fake keeps them.
describe('a remote dashboard’s snapshot holds (P5 O7 M5c)', { timeout: 30_000 }, () => {
  const BOARD = '7c1f0c4e-6b2d-4c8a-9e1f-2b3c4d5e6f71';

  it('holds another machine’s snapshot there for the window, released by it; a forced drop takes the channel’s holds, and main asks nothing of the next', async () => {
    const l = await lab({ link: { UP_GRACE_MS: 100, BACKOFF_MS: [0, 100, 100] } });
    l.host.add('app-1');
    l.place('app-1');
    l.host.artifact(BOARD, ['app-1'], { kind: 'dashboard' });
    const machine = l.f.ref as MachineRef;
    const host = fakeAssetHolds(l.f.services);
    const holds = createDatasetHolds({ call: () => Promise.reject(new Error('this Mac’s host holds nothing of the machine')), remote: (ref) => (ref === machine ? l.a.link : null) });
    const { client } = l.a.page('page-board');
    const first = await holds.hold({ artifactId: BOARD, refs: ['assets/query-1.json'] }, client, machine);
    expect(host.held(BOARD, 'assets/query-1.json')).toBe(true);
    expect(await holds.release(first, client)).toEqual({ released: true });
    expect(host.released()).toBe(1);

    const second = await holds.hold({ artifactId: BOARD, refs: ['assets/query-2.json'] }, client, machine);
    const was = l.a.link.peerCapabilities();
    l.a.carriers.at(-1)!.carrier.close('dropped');
    await until(() => host.released() === 2, 'the endpoint’s release of the dropped channel’s hold');
    await until(() => l.a.link.state() === 'up' && l.a.link.peerCapabilities() !== null && l.a.link.peerCapabilities() !== was, 'the next channel');
    const asked = host.releaseAsked();
    expect(await holds.release(second, client)).toEqual({ released: true });
    expect(host.releaseAsked()).toBe(asked); // the hold was the ended channel's: nothing asked of the next

    await holds.hold({ artifactId: BOARD, refs: ['assets/query-3.json'] }, client, machine); // on the next channel
    client.end();
    await until(() => host.released() === 3, 'the window’s end released its hold on the machine');
  });
});

// The desk track's round 3 on M6a's G1: a checkout feed the endpoint ended `behind` drops the `session.changed` it held
// (an owner's, its head moved while it waited; or a backlog past its bound), and nothing in its reopening said what the
// record is now. The reopening reads it, under the caller (the endpoint gives each member their own reading).
describe('a remote session’s record across a checkout feed’s reopening', { timeout: 30_000 }, () => {
  it('reads the record again when its feed opens after it ended `behind`, the change it held lost', async () => {
    const l = await lab();
    const s = l.host.add('app-1');
    l.place('app-1');
    await opened(l.a, 'app-1', s.launchId);
    const told = () => l.a.emitted.filter((e) => e.name === 'session.changed' && (e.payload.record as SessionRecord).appId === 'app-1').map((e) => e.payload.record as SessionRecord);
    await until(() => told().length > 0, 'the session’s record');
    // The feed's subscription held: a change of the session's record is checked again, the authorizer made to wait.
    const authorizer = l.f.endpoint.authorizer;
    const authorize = authorizer.authorize.bind(authorizer);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    authorizer.authorize = async (request, who, now) => (await gate, authorize(request, who, now));
    l.f.records.set({ lane: 'B', session: 'eng-app-1', owners: ['@machine'] }, 'app-1');
    // The machine's record changes and is told to A, an owner: queued behind the hold.
    const current = { ...record('app-1', { engineSessionId: 'eng-app-1' as never, directory: CHECKOUT }), title: { text: 'renamed on the machine', source: 'user' as const } };
    l.f.spine.records.set('app-1', current); // what the machine's `session.get` answers now
    l.f.host.emitMachine('session.changed', { record: current, cause: 'update', revision: 5 });
    await sleep(100);
    // A new head (nothing in it moves A): the owners' reading queued under the one before no longer goes.
    const next = await successor(l.chain.at(-1)!, [org.a1], () => {});
    const delivered = await l.f.endpoint.cli('revoke', ['-'], JSON.stringify(next));
    expect(delivered.code, delivered.out).toBe(0);
    l.chain.push(next);
    release();
    await until(() => told().at(-1)?.title.text === 'renamed on the machine', 'the record, read again at the feed’s reopening', 5000);
    expect(told().at(-1)).toEqual(current);
  });
});
