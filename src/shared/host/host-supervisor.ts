// The host supervisor (charter §4.1; §12 C1 *Utility processes, build and start*), the core shared by main and (P5 O2)
// `mawsd`. It reaches each host once, speaks the host protocol to it, restarts a host that dies unexpectedly, and
// answers for a host's state itself, so a crashed host still reports. Hosts are process-scoped: nothing here knows
// about windows or pages, so a renderer reload never touches them.
// E10: a host's spec names its transport. `utility` is an Electron utility process, which only main can launch (its
// `launchUtility`, src/main/hosts/supervisor.ts); `detached` reaches a host that outlives its client, over a Unix
// socket (detached-transport.ts). Both say the host protocol's `ready` line after the host's resync (if one is
// registered), and hold requests made while the host is starting or restarting until it is ready.
// P5 O1 M5: a `machine` host is reached the same way, and a request for a `machine`-owned command carries its asker's
// client id; each link relays, once per client it carried, that client's end (`clientGone`, @shared/host/client-refs).
// P5 O1 M6 (OX1): a detached host may be another build of the wire's major, so what a host sends is read tolerantly
// (@shared/ipc/tolerant): the envelope, each output and each event lose the object keys this build does not know, logged
// once per message and path, and an event this build does not know is dropped with one line per name. What reaches the
// renderer has then passed this build's schemas. The supervisor keeps what each welcome said of its peer (`peer`).
//
// P5 O2 M3 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): this core imports no Electron, so a plain Node process
// (`mawsd`) runs it; main injects its Electron facts (`launchUtility`, `userData`, `packaged`). What a relay needs:
// - `readyBy: 'external'`: the ready line waits for `sayReady(owner)` (the relay's own client's ready), not a resync;
// - `recycle(owner)`: a draining close of the served connection (every line the host wrote before it saw the end still
//   arrives), then a fresh connection at once, with no backoff and no crash count;
// - `onDemand`: a deliberate exit parks the host (internal: its HostState stays `restarting`) until `wake(owner)` or the
//   next dispatch; such a host is parked from `start()` on, and `adopt(owner)` connects to one already running with no
//   spawn;
// - `forward(owner, request)` and `onRaw(owner, listener)`: requests, answers and events as received, unvalidated, so a
//   field this build does not know passes through.
// A detached pty host that crashed (its welcomed pid gone) takes its ptys with it, so the supervisor says `pty.exit` for
// each, as the utility path does; a quiet loss (the pid lives, the link closed) says nothing, since the shells live on.
//
// P5 O2 M5: what `mawsd`'s relay reflects and takes back: the served welcome's facts (`welcome`), an exit-when-idle it
// asked and takes back by command (`disarmExit`), the loss to another client told apart (`onReplaced`), a park told
// (`onParked`, since it is no HostState transition), and a document channel's end with its reason (doc-relay.ts's
// `closedBy`).
import { ipcError } from '../ipc/errors';
import type { ClientRef } from '../ipc/client'; // P5 O1 M5
import { HostToMainSchema, type HostDoc, type HostMessage, type HostResponse } from '../ipc/host-protocol';
import { REGISTRY, type WireRegistry } from '../ipc/registry'; // P5 O1 M5
import type { CommandName, CommandResult, EventName, EventPayload, HostState, PtyId } from '../ipc/schema';
import type { Owner } from '../ipc/schema/common';
import type { HostStatus } from '../ipc/schema/host'; // E10
import { readTolerant, tolerantLog } from '../ipc/tolerant'; // P5 O1 M6
import { codecOf } from '../ipc/validate';
import type { WirePeer } from '../ipc/wire'; // P5 O1 M6
import { clientGoneRelay, type ClientGoneRelay } from './client-refs'; // P5 O1 M5
import { createDetachedTransport, refusedOn, type DetachedEvents, type DetachedTransport, type DetachedTransportOptions, type ExitInfo, type HostLink, type Welcomed } from './detached-transport'; // E10
import { MainDocRelay, type RelayPort } from './doc-relay'; // P3-A M5
import { DocumentsClosedSchema, SOCKET_PROTOCOL_V2, type ServerRefuse } from './socket-protocol'; // P3-A M5

// The hosts a client reaches, and how a command is sent to one (main's router re-exports both).
export type HostOwner = Exclude<Owner, 'main'>;
export type HostDispatch = (owner: HostOwner, name: string, input: unknown, client?: ClientRef) => Promise<CommandResult<CommandName>>;

export interface HostSpec {
  modulePath: string; // the bundled entry, from electron-vite's `?modulePath` import
  serviceName: string; // the name `app.getAppMetrics()` reports for the process
  transport?: 'utility' | 'detached'; // E10: `utility` unless said otherwise
  // P5 O2 M3 start
  readyBy?: 'resync' | 'external'; // `resync` unless said otherwise; `external`: the ready line waits for sayReady
  onDemand?: boolean; // parked until woken (above)
  detached?: Partial<Omit<DetachedTransportOptions, 'modulePath'>>; // this host's own transport facts, over the supervisor's
  // P5 O2 M3 end
  // A name's own completion budget in place of REQUEST_TIMEOUT_MS: main's `machine` host gives the daemon's commands that
  // run longer (a take-over's stop and wait, an acquisition's launch) what they had in main (the panel's sweep#3)
  requestBudgetsMs?: Readonly<Partial<Record<string, number>>>;
}

// P5 O2 M3: a utility host as main's launcher made it (utilityProcess.fork with a MessageChannelMain): the child,
// main's end of the channel whose other end the launcher handed the child with its hello, and how a document's port is
// handed to the child (P3-A M4).
export interface UtilityChild {
  readonly pid: number | undefined;
  on(event: 'spawn', listener: () => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

export interface UtilityPort {
  postMessage(message: HostMessage): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  start(): void;
  close(): void;
}

export interface UtilityLink {
  child: UtilityChild;
  port: UtilityPort;
  postDoc(message: HostDoc, port: RelayPort): void;
}

export interface HostSupervisorOptions {
  hosts: Partial<Record<HostOwner, HostSpec>>; // P5 O1 M5: the hosts this process runs
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => boolean; // relays host events (main: to the renderer)
  // E10 start
  // The detached transports' facts and seams, under each host's own (HostSpec.detached).
  detached?: Partial<Omit<DetachedTransportOptions, 'modulePath'>>;
  restartBackoffMs?: readonly number[]; // RESTART_BACKOFF_MS unless a test shortens it
  // E10 end
  registry?: WireRegistry; // P5 O1 M5: what outputs and events are read against; REGISTRY unless a test brings its own
  // P5 O2 M3 start: the facts Electron gave the supervisor before it left main
  launchUtility?(spec: HostSpec): UtilityLink; // throws when the fork fails; a process without it runs detached hosts only
  userData(): string; // the profile's directory, read at each detached attempt
  packaged(): boolean;
  // P5 O2 M3 end
  onReplaced?(owner: HostOwner): void; // P5 O2 M5: another client took a detached host (it is crashed for good)
  onParked?(owner: HostOwner, parked: boolean): void; // P5 O2 M5: an on-demand host parked, or left its park
}

// E10: what main pulls from a host between its connect and its `ready` line (X13: the host emits nothing before it).
// The host is `ready` while it runs. The signal aborts when the host leaves that connection (reason `transition`) or at
// RESYNC_BOUND_MS (reason `bound`), and the ready line goes without waiting for the resync either way; once it has
// aborted, the dispatch answers `host_unavailable` at once, so no request of a cancelled resync is held for the next
// connection.
export type ResyncCancel = 'transition' | 'bound';
export type HostResync = (dispatch: HostDispatch, signal: AbortSignal) => Promise<void>;

// E10 Task 2.3b: what main knows of a host beyond its HostState, for `host.status` (main's status.ts). They change only
// with a transition, so `onState` announces them.
export interface HostFacts {
  transport: 'utility' | 'detached';
  reason: HostStatus['reason']; // why `crashed`, when main knows: an incompatible supervisor runs sessions, or a held lock
  refused: 'wire' | 'protocol' | null; // while `incompatible`: what the supervisor's refusal named
  waitingLiveSessions: number | null; // while `incompatible`: the sessions its last refusal said it runs (Task 2.4)
  lastExit: { code: number | null; signal: string | null; at: string } | null; // the last unexpected exit this app run
}

export interface HostSupervisor {
  // idempotent: launches once; resolves when each host's first launch is ready or has given up (P5 O2 M3: an on-demand
  // host is parked, settled at once)
  start(): Promise<void>;
  // terminal: kills a utility host (E10: closes a detached engine host's socket with no exit, so its supervisor keeps
  // serving), fails what is pending and held, never restarts; a later start() starts nothing. E11: answers once a
  // detached host's draining close has ended (bounded by the socket port's grace); nothing when nothing drains, so an
  // ordinary quit is not held and keeps Electron's own path (Decision Log 28)
  stop(): Promise<void> | undefined;
  dispatch: HostDispatch;
  snapshot(owner: HostOwner): HostState;
  onState(owner: HostOwner, listener: (state: HostState) => void): () => void;
  // C3 start: main-side subscription to validated host events, beside onState (wave-2 ledger (b)); a listener runs after
  // the event was relayed to the renderer, only for a payload that passed X2. C3's attention service and C4's index use it.
  onEvent<N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): () => void;
  // C3 end
  // E10 start
  // Registers the resync run between a host's connect and its `ready` line, on every connect (null: ready at once).
  setResync(owner: HostOwner, resync: HostResync | null): void;
  // Once per connection, after the `ready` line was sent (after the resync, if any): the host's events reach main from
  // here, so a command whose effect comes back only as events is dispatched here rather than at the `ready` state.
  onStreaming(owner: HostOwner, listener: () => void): () => void;
  streaming(owner: HostOwner): boolean; // from the `ready` line until the host leaves `ready`
  // Asks a detached host (the engine host's supervisor unless `owner` says otherwise) to exit now, or when it holds
  // nothing live; the close that follows is deliberate (no crash count, a fresh start once it is gone, or (P5 O2 M3) a
  // park for an on-demand host). False when the host is not detached and served.
  exitSupervisor(when: 'now' | 'idle', owner?: HostOwner): boolean;
  // P5 O2 M3: the served detached host is about to be sent a command after which it exits whatever its answer (a
  // forwarded `host.stopAll`): its close is then deliberate. False when nothing is served.
  expectExit(owner: HostOwner): boolean;
  facts(owner: HostOwner): HostFacts;
  // Settings' Stop all and the banners' Restart now (`host.restart`), for the engine host. Detached: `host.stopAll`
  // (stopSessions) or `exit now`, then a fresh supervisor once the old pid is dead, with no crash count; a supervisor
  // that holds the lock and never answers is killed first. Utility: the host's sessions stopped, then it is killed and
  // forked afresh (never engine.shutdown on a host that stays: its admission would stay closed).
  restartSupervisor(options: { stopSessions: boolean }): Promise<CommandResult<'host.restart'>>;
  killHeldSupervisor(): Promise<boolean>; // the lock's process, after a start-time check; false when there is none
  // The quit's stop-all, awaited and bounded by the caller. Detached: from here nothing reconnects or spawns, then
  // `host.stopAll` (the supervisor exits after answering); the HostState keeps its pid for the quit's kill rung.
  // Utility: engine.shutdown, as before.
  stopAllForQuit(graceMs: number): Promise<void>;
  // E10 end
  // P3-A M4 (its Decision Log 13): hands one end of a document's channel to the engine host on its parent port, when it
  // runs as a utility process and is ready; false (nothing posted, the caller still holds the port) otherwise.
  // P3-A M5: a detached host's end is kept by main and relayed over a channel of the supervisor's socket (doc-relay.ts),
  // under `owner` (the asking client's id, `ClientRef.id`), while a connection is served and ready.
  postDocPort(message: HostDoc, port: RelayPort, owner?: string): boolean;
  // P3-A M5: the client ended (its page closed, reloaded or crashed): the channels main relays for it end (a utility
  // host's ports, entangled with the page's directly, end by themselves).
  closeDocPorts(owner: string): void;
  // P5 O1 M6: what the served supervisor's welcome said of it (major, minor, build, capabilities), so a caller can gate a
  // behaviour an older peer lacks; null while none is served, and for a utility host (always this build)
  peer(owner: HostOwner): WirePeer | null;
  // P5 O2 M3 start (above)
  sayReady(owner: HostOwner): void; // an `external` host's ready line, on its served connection (or the next, if none)
  // Resolves once the fresh connection is welcomed (or the host crashed, or the supervisor stopped); `drained` runs when
  // the old connection's draining close has ended (or the socket port's grace ran out), before the reconnect.
  recycle(owner: HostOwner, events?: { drained?(): void }): Promise<void>;
  wake(owner: HostOwner): void; // a parked host launches
  adopt(owner: HostOwner): Promise<boolean>; // a parked host: one connect, no spawn; false leaves it parked
  parked(owner: HostOwner): boolean;
  refusal(owner: HostOwner): ServerRefuse | null; // while `incompatible`: the refusal's whole line, for a relay to reflect
  forward(owner: HostOwner, request: { name: string; input: unknown; client?: string }): Promise<HostResponse>;
  onRaw(owner: HostOwner, listener: (message: { name: string; payload: unknown }) => void): () => void;
  // P5 O2 M3 end
  // P5 O2 M5 start (above)
  welcome(owner: HostOwner): Welcomed | null; // the served detached link's welcome; null while none is served
  disarmExit(owner: HostOwner): boolean; // the transport's disarmIdle
  expectIdleExit(owner: HostOwner): boolean; // the transport's expectIdleExit: a host.exitWhenIdle {armed: true} it answered
  // P5 O2 M5 end
}

export const REQUEST_TIMEOUT_MS = 10_000;
// The wait before the 1st, 2nd and 3rd-and-later restart of a host since app start.
export const RESTART_BACKOFF_MS = [500, 2_000, 5_000] as const;
// This many unexpected exits within the window leave a host `crashed` for good.
export const CRASH_LIMIT = 3;
export const CRASH_WINDOW_MS = 60_000;
// E10: past this the `ready` line goes without the resync's answer (the resync logs what it left undone).
export const RESYNC_BOUND_MS = 30_000;
// E10: the grace host.restart's stop-all gives each session (the quit's, as the quit guard asks it)
export const STOP_ALL_GRACE_MS = 5_000;

interface Pending {
  name: string;
  resolve: (result: CommandResult<CommandName>) => void;
  raw: ((response: HostResponse) => void) | null; // P5 O2 M3: a forwarded request, answered as received
  timer: ReturnType<typeof setTimeout>;
  request: HostMessage; // E10: kept until it is sent: a request made while the host starts is held
  sent: boolean;
  client: ClientRef | null; // P5 O1 M5: the asker a `machine` request names, whose end the link relays once it is sent
  forwardedClient: string | null; // P5 O2 M3: a forwarded request's `client`, kept off a protocol-2 link
}

// E10: the port a host is spoken to through, a utility host's channel or the detached transport's socket link.
interface MainPort {
  postMessage(message: HostMessage): void;
  close(): void;
}

interface Host {
  owner: HostOwner;
  spec: HostSpec;
  state: HostState;
  utility: UtilityLink | null; // a utility host's child and channel
  port: MainPort | null;
  pending: Map<string, Pending>;
  exits: number[]; // times of unexpected exits inside the crash window
  restartTimer: ReturnType<typeof setTimeout> | null;
  listeners: Set<(state: HostState) => void>;
  settleFirstLaunch: () => void;
  // PTY host only: the ptys the renderer was told about and not yet told have exited. When the host dies they die
  // with it, and the supervisor is the one left to say so.
  ptys: Set<string>;
  // E10 start
  resync: HostResync | null;
  resyncing: AbortController | null; // the resync in flight on the current connection
  streaming: boolean; // told `ready` on the current connection
  streamingListeners: Set<() => void>;
  transport: DetachedTransport | null; // a detached host's; null for a utility host
  reason: HostFacts['reason'];
  refused: HostFacts['refused'];
  waitingLiveSessions: HostFacts['waitingLiveSessions'];
  refusal: ServerRefuse | null; // P5 O2 M3: while `incompatible`
  lastExit: HostFacts['lastExit'];
  quitting: boolean; // stopAllForQuit was asked: nothing restarts, nothing more is held
  utilityRestart: Promise<CommandResult<'host.restart'>> | null; // a utility restart under way, until it forks the successor
  // E10 end
  relay: MainDocRelay | null; // P3-A M5: a detached host's document channels
  gone: ClientGoneRelay | null; // P5 O1 M5: the current link's clientGone relay
  peer: WirePeer | null; // P5 O1 M6: the served link's welcome, until it detaches
  welcome: Welcomed | null; // P5 O2 M5: the whole of it
  // P5 O2 M3 start
  parked: boolean; // an on-demand host with no launch under way
  readyAsked: boolean; // an external host's sayReady with no connection to say it on yet
  raw: Set<(message: { name: string; payload: unknown }) => void>;
  settled: Set<() => void>; // recycles waiting for the host's next ready or crashed
  // P5 O2 M3 end
}

export function createHostSupervisor(options: HostSupervisorOptions): HostSupervisor {
  const { hosts: specs, emit, detached, restartBackoffMs = RESTART_BACKOFF_MS } = options;
  const registry: WireRegistry = options.registry ?? REGISTRY;
  const { isEventName, readCommandOutput, readEventPayload } = codecOf(registry); // P5 O1 M5; M6: the tolerant readers
  // P5 O1 M6: one line per dropped field, and one per event name this build does not know
  const logDropped = tolerantLog((line) => console.warn(`[hosts] ${line}`));
  const unknownEvents = new Set<string>();
  const hosts: Partial<Record<HostOwner, Host>> = {};
  // P5 O1 M5: for the calls that name a host this process runs
  const hostOf = (owner: HostOwner): Host => {
    const host = hosts[owner];
    if (!host) throw new Error(`no ${owner} host runs in this process`);
    return host;
  };
  for (const [owner, spec] of Object.entries(specs) as [HostOwner, HostSpec][]) {
    // P5 O2 M3: a utility process needs Electron's launcher; a plain Node process can run detached hosts only
    if (spec.transport !== 'detached' && !options.launchUtility) throw new Error(`${owner} asks for a utility process, which this process cannot launch`);
    const host: Host = {
      owner,
      spec,
      state: { state: 'starting', pid: null, restarts: 0, revision: 0 },
      utility: null,
      port: null,
      pending: new Map(),
      exits: [],
      restartTimer: null,
      listeners: new Set(),
      settleFirstLaunch: () => {},
      ptys: new Set(),
      resync: null,
      resyncing: null,
      streaming: false,
      streamingListeners: new Set(),
      transport: null,
      reason: null,
      refused: null,
      waitingLiveSessions: null,
      refusal: null,
      lastExit: null,
      quitting: false,
      utilityRestart: null,
      relay: null, // P3-A M5
      gone: null, // P5 O1 M5
      peer: null, // P5 O1 M6
      welcome: null, // P5 O2 M5
      parked: false, // P5 O2 M3
      readyAsked: false,
      raw: new Set(),
      settled: new Set(),
    };
    // E10: a detached host's transport, reporting into the same state, ladder and requests as a utility host's
    if (host.spec.transport === 'detached') {
      const transportOptions: DetachedTransportOptions = {
        userData: options.userData,
        packaged: options.packaged,
        log: (line) => console.log(`[hosts] ${owner}: ${line}`),
        ...detached,
        ...spec.detached, // P5 O2 M3
        modulePath: spec.modulePath,
      };
      host.transport = createDetachedTransport(transportOptions, detachedEvents(host));
      host.relay = new MainDocRelay(); // P3-A M5
    }
    hosts[owner] = host;
  }
  let started: Promise<void> | null = null;
  let stopped = false;
  // C3 start
  const eventListeners = new Map<EventName, Set<(payload: never) => void>>();
  function notifyEvent(name: EventName, payload: unknown): void {
    for (const listener of eventListeners.get(name) ?? []) {
      try {
        (listener as (p: unknown) => void)(payload);
      } catch (error) {
        console.error(`[hosts] a listener for ${name} failed`, error);
      }
    }
  }
  // C3 end
  let nextRequestId = 0;

  function transition(host: Host, next: Omit<HostState, 'revision'>): void {
    cancelResync(host, 'transition'); // E10: the connection it pulled through is gone (or replaced)
    host.streaming = false; // E10
    if (next.state !== 'crashed') clearReason(host); // E10: a reason is a crashed host's
    host.state = { ...next, revision: host.state.revision + 1 };
    if (next.state === 'crashed') failHeld(host, 'is crashed'); // E10: a held request fails only on crashed or stop()
    for (const listener of host.listeners) listener(host.state);
    if (next.state === 'ready' || next.state === 'crashed') settle(host); // P5 O2 M3: a recycle's end
  }

  // P5 O2 M3: an on-demand host parks or leaves its park (P5 O2 M5: told, since a park is no HostState transition)
  function park(host: Host, parked: boolean): void {
    if (host.parked === parked) return;
    host.parked = parked;
    options.onParked?.(host.owner, parked);
  }

  // P5 O2 M3: what waits for the host's next ready or crashed (a recycle)
  function settle(host: Host): void {
    const waiting = [...host.settled];
    host.settled.clear();
    for (const resolve of waiting) resolve();
  }

  function launch(host: Host): void {
    park(host, false); // P5 O2 M3
    if (host.transport) return host.transport.launch(); // E10: a detached host is reached by its transport
    let link: UtilityLink;
    try {
      link = options.launchUtility!(host.spec);
    } catch (error) {
      console.error(`[hosts] could not fork ${host.owner}`, error);
      exited(host, null);
      return;
    }
    const { child, port } = link;
    host.utility = link;
    host.port = port;
    host.gone = clientGoneRelay((message) => port.postMessage(message)); // P5 O1 M5
    sendHeld(host); // E10: what was asked while the host was restarting goes out on the new port

    child.on('spawn', () => {
      if (host.utility !== link) return;
      transition(host, { state: 'ready', pid: child.pid ?? null, restarts: host.state.restarts });
      host.settleFirstLaunch();
      if (external(host)) readyIfAsked(host); // P5 O2 M3
      else if (host.resync) sayReady(host, port); // E10: after the resync, which needs the host ready
      else streaming(host); // E10: told ready at hello, below
    });
    child.on('exit', (code) => {
      if (host.utility === link) exited(host, code);
    });

    port.on('message', ({ data }) => receive(host, data));
    port.start();
    // E10: the host emits no event before main's ready line (X13). A host with nothing to pull (the pty host) is told
    // at once, so the port delivers it ahead of every request; one with a resync is told once the resync is done.
    if (!host.resync && !external(host)) port.postMessage({ t: 'ready' } satisfies HostMessage);
  }

  // E10: the `ready` line, after the host's resync (bounded by RESYNC_BOUND_MS), on the port it was pulled through: a
  // host that left `ready` meanwhile is not told (its resync was cancelled). Then the streaming listeners.
  function sayReady(host: Host, port: MainPort): void {
    const resync = host.resync;
    const ready = () => {
      if (host.port !== port) return;
      port.postMessage({ t: 'ready' });
      streaming(host);
    };
    if (!resync) return ready();
    const controller = new AbortController();
    host.resyncing = controller;
    // The resync's own dispatch: refused once the resync is cancelled, so nothing it asks is held for a later connection.
    const resyncDispatch: HostDispatch = (owner, name, input) =>
      controller.signal.aborted
        ? Promise.resolve({ ok: false, error: ipcError('host_unavailable', `${owner}'s resync was cancelled (${String(controller.signal.reason)}); ${name} not sent`) })
        : dispatch(owner, name, input);
    const bound = setTimeout(() => {
      console.error(`[hosts] ${host.owner}'s resync took longer than ${RESYNC_BOUND_MS / 1000} s; saying ready without it`);
      cancelResync(host, 'bound');
    }, RESYNC_BOUND_MS);
    const ended = new Promise<void>((resolve) => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    const pulled = Promise.resolve()
      .then(() => resync(resyncDispatch, controller.signal))
      .catch((error: unknown) => console.error(`[hosts] ${host.owner}'s resync failed`, error));
    void Promise.race([pulled, ended]).then(() => {
      clearTimeout(bound);
      if (host.resyncing === controller) host.resyncing = null;
      if (controller.signal.reason !== 'transition') ready();
    });
  }

  // P5 O2 M3 start: an external host's ready line, said when its owner asks (sayReady) on the served connection
  const external = (host: Host) => host.spec.readyBy === 'external';

  function readyIfAsked(host: Host): void {
    if (!host.readyAsked || !host.port || host.state.state !== 'ready' || host.streaming) return;
    host.readyAsked = false;
    host.port.postMessage({ t: 'ready' });
    streaming(host);
  }
  // P5 O2 M3 end

  function cancelResync(host: Host, reason: ResyncCancel): void {
    const controller = host.resyncing;
    if (!controller) return;
    host.resyncing = null;
    controller.abort(reason);
  }

  function streaming(host: Host): void {
    host.streaming = true;
    for (const listener of host.streamingListeners) {
      try {
        listener();
      } catch (error) {
        console.error(`[hosts] a streaming listener of ${host.owner} failed`, error);
      }
    }
  }

  // Fails the requests the host was sent; E10: the ones still held wait for the next connect.
  function detach(host: Host, reason: string): void {
    unlink(host);
    host.utility = null;
    host.port?.close();
    host.port = null;
    failSent(host, reason);
  }

  // What ends with a link, whether it closes now or (P5 O2 M3, a recycle) drains first.
  function unlink(host: Host): void {
    host.relay?.disconnect(); // P3-A M5: every relayed window port ends with the connection
    host.gone?.close(); // P5 O1 M5: the host ends this link's remote clients by itself
    host.gone = null;
    host.peer = null; // P5 O1 M6
    host.welcome = null; // P5 O2 M5
  }

  function failSent(host: Host, reason: string): void {
    for (const [id, pending] of host.pending) {
      if (!pending.sent) continue;
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: ipcError('host_unavailable', `${host.owner} ${reason} before answering ${pending.name}`) });
      host.pending.delete(id);
    }
  }

  // E10 start
  function clearReason(host: Host): void {
    [host.reason, host.refused, host.waitingLiveSessions, host.refusal] = [null, null, null, null];
  }

  function failHeld(host: Host, reason: string): void {
    for (const [id, pending] of host.pending) {
      if (pending.sent) continue;
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: ipcError('host_unavailable', `${host.owner} ${reason}; cannot answer ${pending.name}`) });
      host.pending.delete(id);
    }
  }

  function send(host: Host, pending: Pending): void {
    pending.sent = true;
    // P5 O2 M3: a forwarded `client` never reaches a protocol-2 link, whose strict `req` refuses it (P5 Decision Log 42)
    const request = pending.forwardedClient && host.peer?.major !== SOCKET_PROTOCOL_V2 ? { ...pending.request, client: pending.forwardedClient } : pending.request;
    host.port!.postMessage(request);
    if (pending.client) host.gone?.carry(pending.client); // P5 O1 M5: after the request, so a gone client's line follows it
  }

  function sendHeld(host: Host): void {
    for (const pending of host.pending.values()) if (!pending.sent) send(host, pending);
  }

  const holdsAny = (host: Host) => [...host.pending.values()].some((pending) => !pending.sent);

  // An unexpected exit, counted in the crash window: at the limit (three within 60 s) the host stays crashed for good;
  // else the wait before the next start, by the restarts so far.
  function recordExit(host: Host, exit: Omit<NonNullable<HostFacts['lastExit']>, 'at'>): { limit: boolean; delay: number } {
    const now = Date.now();
    host.lastExit = { ...exit, at: new Date(now).toISOString() };
    host.exits = [...host.exits.filter((at) => now - at < CRASH_WINDOW_MS), now];
    const limit = host.exits.length >= CRASH_LIMIT;
    if (limit) console.error(`[hosts] ${host.owner} exited ${host.exits.length} times within ${CRASH_WINDOW_MS / 1000} s; not restarting`);
    return { limit, delay: restartBackoffMs[Math.min(host.state.restarts, restartBackoffMs.length - 1)] };
  }

  // The ptys a dead pty host took with it: the renderer is told each has exited.
  function ptysGone(host: Host): void {
    for (const ptyId of host.ptys) emit('pty.exit', { ptyId: ptyId as PtyId, exitCode: null, signal: null });
    host.ptys.clear();
  }

  // The detached transport's reports, read into the state table of §Design 1 with the utility host's ladder.
  function detachedEvents(host: Host): DetachedEvents {
    const relaunch = (delay: number) => {
      host.restartTimer = setTimeout(() => {
        host.restartTimer = null;
        launch(host);
      }, delay);
    };
    // A connection main did not end itself: the host is restarting from here on, and requests are held again.
    const disconnected = () => {
      if (!host.port) return;
      detach(host, 'disconnected');
      transition(host, { state: 'restarting', pid: null, restarts: host.state.restarts });
    };
    // An unexpected exit: C1's ladder, counted in the crash window (three within 60 s leave it crashed for good).
    // Between the exit and the next attempt the host is `restarting`, so requests are held for the successor.
    const unexpected = (exit: ExitInfo) => {
      console.error(`[hosts] ${host.owner} exited unexpectedly (${exit.signal ?? `code ${exit.code}`})`);
      ptysGone(host); // P5 O2 M3: a detached pty host's ptys died with it
      const { limit, delay } = recordExit(host, exit);
      if (limit) {
        clearReason(host); // crashed for its exits, whatever an earlier wait named
        transition(host, { state: 'crashed', pid: host.state.pid, restarts: host.state.restarts });
        host.settleFirstLaunch();
        return;
      }
      transition(host, { state: 'restarting', pid: null, restarts: host.state.restarts + 1 });
      relaunch(delay);
    };
    // A fact that changes while crashed (another reason, a waited-for supervisor's live count) is a transition too, so
    // host.status reports it.
    const crashed = (why: string, facts: Partial<Pick<HostFacts, 'reason' | 'refused' | 'waitingLiveSessions'> & { refusal: ServerRefuse }> = {}) => {
      console.error(`[hosts] ${host.owner} ${why}`);
      detach(host, 'is unreachable');
      const { reason = null, refused = null, waitingLiveSessions = null, refusal = null } = facts;
      const changed = host.reason !== reason || host.refused !== refused || host.waitingLiveSessions !== waitingLiveSessions || JSON.stringify(host.refusal) !== JSON.stringify(refusal);
      [host.reason, host.refused, host.waitingLiveSessions, host.refusal] = [reason, refused, waitingLiveSessions, refusal];
      if (host.state.state !== 'crashed' || changed) transition(host, { state: 'crashed', pid: host.state.pid, restarts: host.state.restarts });
      host.settleFirstLaunch();
    };
    // P5 O2 M3: a deliberate exit parks an on-demand host, unless a request is already held for it
    const deliberate = () => {
      if (host.spec.onDemand && !holdsAny(host)) {
        park(host, true);
        settle(host); // P5 O2 M5: a recycle of a host asked to exit ends here
        return;
      }
      launch(host);
    };
    return {
      connected(link: HostLink, welcome) {
        if (stopped) return link.close();
        park(host, false); // P5 O2 M3: an adoption, or a launch, reached it
        host.port = link;
        host.peer = welcome.peer; // P5 O1 M6
        host.welcome = welcome; // P5 O2 M5
        host.gone?.close(); // P5 O1 M5: a link's relay never outlives it
        host.gone = clientGoneRelay((message) => link.postMessage(message));
        // P3-A M5: the document channels' frames and the host's `documents.closed` go to the relay, not the envelope
        host.relay?.connect(link);
        link.onDoc((channel, frame) => host.relay?.deliver(channel, frame));
        link.onMessage((data) => {
          const closed = readTolerant(DocumentsClosedSchema, data); // P5 O1 M6: a newer supervisor's close still ends the port
          if (!closed.ok) {
            receive(host, data);
            return;
          }
          logDropped('socket documents.closed', closed.dropped);
          host.relay?.closed(closed.value.channel, closed.value.reason); // P5 O2 M5: with its reason
        });
        transition(host, { state: 'ready', pid: welcome.pid, restarts: host.state.restarts });
        sendHeld(host);
        host.settleFirstLaunch();
        if (external(host)) readyIfAsked(host); // P5 O2 M3
        else sayReady(host, link);
      },
      disconnected() {
        if (stopped) return;
        if (host.quitting) return detach(host, 'stopped for the quit'); // the state keeps its pid for the quit's kill rung
        disconnected();
      },
      lost(loss) {
        if (stopped) return;
        if (loss === 'replaced') {
          crashed('was taken over by another client of its supervisor; not reconnecting');
          return options.onReplaced?.(host.owner); // P5 O2 M5
        }
        disconnected();
        if (loss === 'quiet') return relaunch(restartBackoffMs[0]);
        if (loss === 'deliberate') return deliberate();
        unexpected(loss.crash);
      },
      exited(exit) {
        if (!stopped) unexpected(exit);
      },
      failed(reason, message) {
        if (!stopped) crashed(`could not be reached${reason === 'held_lock' ? ' (held_lock)' : ''}: ${message}`, { reason: reason === 'held_lock' ? 'held_lock' : null });
      },
      waiting(refuse) {
        if (stopped) return;
        const refused = refusedOn(refuse);
        crashed(`has an incompatible supervisor running ${refuse.liveSessions} sessions; waiting for it`, { reason: 'incompatible', refused, waitingLiveSessions: refuse.liveSessions, refusal: refuse });
      },
      // P5 O2 (the bundle swap): a spawn declined counts no exit; what waited for it fails with the reason, and an
      // on-demand host parks again, so the next request or wake asks once more
      notLaunched(reason) {
        if (stopped) return;
        console.error(`[hosts] ${host.owner} not launched: ${reason}`);
        failHeld(host, `is not launched (${reason})`);
        if (!host.spec.onDemand) return crashed(`is not launched: ${reason}`);
        park(host, true);
        settle(host);
        host.settleFirstLaunch();
      },
    };
  }
  // E10 end

  function exited(host: Host, code: number | null): void {
    detach(host, 'exited');
    if (stopped) return;
    console.error(`[hosts] ${host.owner} exited unexpectedly (code ${code})`);
    ptysGone(host);

    const { limit, delay } = recordExit(host, { code, signal: null });
    transition(host, { state: 'crashed', pid: host.state.pid, restarts: host.state.restarts });
    if (limit) {
      host.settleFirstLaunch();
      return;
    }
    host.restartTimer = setTimeout(() => {
      host.restartTimer = null;
      transition(host, { state: 'restarting', pid: null, restarts: host.state.restarts + 1 });
      launch(host);
    }, delay);
  }

  function receive(host: Host, data: unknown): void {
    // P5 O2 M3: what a relay forwards as received, before this build's schemas
    const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
    if (record?.t === 'evt' && typeof record.name === 'string') {
      const message = { name: record.name, payload: record.payload };
      for (const listener of host.raw) listener(message);
    }
    if (record?.t === 'res' && typeof record.id === 'string') {
      const pending = host.pending.get(record.id);
      if (pending?.raw) {
        clearTimeout(pending.timer);
        host.pending.delete(record.id);
        pending.raw(data as HostResponse);
        return;
      }
    }
    const message = readTolerant(HostToMainSchema, data); // P5 O1 M6: this and the readers below are tolerant
    if (!message.ok) {
      console.error(`[hosts] dropped a malformed message from ${host.owner}`, message.error.issues);
      return;
    }
    logDropped(`envelope ${message.value.t}`, message.dropped);
    if (message.value.t === 'evt') {
      const { name } = message.value;
      if (!isEventName(name)) {
        // P5 O1 M6: an event a newer build emits and this one does not know
        if (unknownEvents.has(name)) return;
        unknownEvents.add(name);
        console.warn(`[hosts] dropped ${host.owner}'s event ${name}: not in this build's event registry (logged once per name)`);
        return;
      }
      const read = readEventPayload(name, message.value.payload);
      if (!read.ok) {
        console.error(`[hosts] dropped ${host.owner}'s invalid ${name}`, read.issues);
        return;
      }
      logDropped(`event ${name}`, read.dropped);
      const payload = read.value;
      const relayed = emit(name as EventName, payload as never);
      if (relayed && name === 'pty.exit') host.ptys.delete((payload as { ptyId: string }).ptyId);
      if (relayed) notifyEvent(name as EventName, payload); // C3: emit validated it, and validators never transform
      return;
    }
    answer(host, message.value);
  }

  function answer(host: Host, response: HostResponse): void {
    const pending = host.pending.get(response.id);
    if (!pending) {
      console.error(`[hosts] dropped ${host.owner}'s response to unknown request ${response.id}`);
      return;
    }
    clearTimeout(pending.timer);
    host.pending.delete(response.id);
    if (!response.ok) {
      pending.resolve({ ok: false, error: response.error });
      return;
    }
    const output = readCommandOutput(pending.name, response.value); // P5 O1 M6: tolerant
    if (!output.ok) {
      console.error(`[hosts] ${host.owner} answered ${pending.name} with an invalid output`, output.error.issues);
      pending.resolve({ ok: false, error: ipcError('internal', output.error.message, output.error.issues) });
      return;
    }
    logDropped(`the output of ${pending.name}`, output.dropped);
    if (pending.name === 'pty.spawn') host.ptys.add((output.value as { ptyId: string }).ptyId);
    pending.resolve({ ok: true, value: output.value } as CommandResult<CommandName>);
  }

  // E10 start: host.restart and the quit's stop-all (Task 2.3b)
  const restarted: CommandResult<'host.restart'> = { ok: true, value: undefined };
  const notRestartable = (host: Host, why: string): CommandResult<'host.restart'> => ({ ok: false, error: ipcError('host_unavailable', `${host.owner} ${why}; it cannot be restarted`) });

  async function restartDetached(host: Host, transport: DetachedTransport, stopSessions: boolean): Promise<CommandResult<'host.restart'>> {
    if (host.state.state === 'ready' && host.port) {
      if (!stopSessions) return transport.exit('now') ? restarted : notRestartable(host, 'could not be asked to exit');
      // A stop-all ends the supervisor whatever it answers (a failed ladder included; past the request deadline it may
      // still be stopping): the close that follows is deliberate.
      transport.expectExit();
      const result = await dispatch(host.owner, 'host.stopAll', { graceMs: STOP_ALL_GRACE_MS });
      return result.ok ? restarted : { ok: false, error: result.error };
    }
    if (host.state.state !== 'crashed') return restarted; // starting or restarting: the attempt under way reaches the newest
    if (host.reason === 'held_lock') await transport.killHeld();
    if (stopped || host.quitting) return notRestartable(host, 'is stopping with the app');
    // waiting: an incompatible supervisor is asked to exit now on its refused connection (it cannot be sent host.stopAll;
    // its exit order stops its sessions either way), and a fresh one starts once it is gone
    const incompatible = host.reason === 'incompatible';
    host.exits = []; // asked for: the crash window starts afresh
    transition(host, { state: 'restarting', pid: null, restarts: host.state.restarts });
    park(host, false); // P5 O2 M3
    if (incompatible) transport.replaceIncompatible();
    else transport.launch();
    return restarted;
  }

  // A utility host's sessions end with it whichever way it is restarted, so they are stopped within the grace first.
  // One restart at a time: a second one asked before the first has forked the successor is answered by the first, so
  // overlapping restarts never fork two successors (one of which nothing would ever stop).
  function restartUtility(host: Host): Promise<CommandResult<'host.restart'>> {
    // started a microtask later, so the latch is set before a restart that forks at once clears it
    host.utilityRestart ??= Promise.resolve().then(() => restartUtilityOnce(host));
    return host.utilityRestart;
  }

  async function restartUtilityOnce(host: Host): Promise<CommandResult<'host.restart'>> {
    const forked = () => {
      host.utilityRestart = null;
      if (!stopped) launch(host);
    };
    if (host.state.state === 'ready' && host.port) {
      const result = await dispatch(host.owner, 'host.stopAll', { graceMs: STOP_ALL_GRACE_MS });
      if (!result.ok) console.warn(`[hosts] ${host.owner}'s stop-all before its restart failed; restarting it anyway`, result.error);
    }
    if (stopped) {
      host.utilityRestart = null;
      return notRestartable(host, 'was stopped');
    }
    if (host.restartTimer) clearTimeout(host.restartTimer);
    host.restartTimer = null;
    host.exits = [];
    const utility = host.utility;
    detach(host, 'was restarted'); // the old child is no longer the host's: its exit is not a crash
    transition(host, { state: 'restarting', pid: null, restarts: host.state.restarts });
    if (!utility) {
      forked();
      return restarted;
    }
    utility.child.on('exit', forked);
    utility.child.kill();
    return restarted;
  }
  // E10 end

  // A request, held while the host starts or restarts; `raw` answers a forwarded one as received (P5 O2 M3).
  function request(owner: HostOwner, name: string, input: unknown, client: ClientRef | null, forwarded: { client: string | null; raw: (response: HostResponse) => void } | null): Promise<CommandResult<CommandName>> {
    const host = hosts[owner];
    if (!host) return Promise.resolve({ ok: false, error: ipcError('host_unavailable', `no ${owner} host runs in this process; cannot answer ${name}`) }); // P5 O1 M5
    // E10: once started, a request made while the host starts or restarts is held and sent when it is ready
    const holds = started !== null && !stopped && !host.quitting && (host.state.state === 'starting' || host.state.state === 'restarting');
    if (!host.port && !holds) {
      return Promise.resolve({ ok: false, error: ipcError('host_unavailable', `${owner} is ${host.state.state}; cannot answer ${name}`) });
    }
    const id = String(++nextRequestId);
    const budgetMs = host.spec.requestBudgetsMs?.[name] ?? REQUEST_TIMEOUT_MS;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        host.pending.delete(id);
        resolve({ ok: false, error: ipcError('timeout', `${owner} did not answer ${name} within ${budgetMs / 1000} s`) });
      }, budgetMs);
      // P5 O1 M5: the client rides on a `machine` request only, so the engine host's envelope (which a pre-O1 supervisor
      // reads strictly) never carries it
      const asker = owner === 'machine' && client ? client : null;
      const message: HostMessage = asker ? { t: 'req', id, name: name as CommandName, input, client: asker.id } : { t: 'req', id, name: name as CommandName, input };
      const pending: Pending = { name, resolve, raw: forwarded?.raw ?? null, timer, request: message, sent: false, client: asker, forwardedClient: forwarded?.client ?? null };
      host.pending.set(id, pending);
      if (host.port) send(host, pending);
      else if (host.parked) launch(host); // P5 O2 M3: a request wakes a parked host
    });
  }

  const dispatch: HostDispatch = (owner, name, input, client) => request(owner, name, input, client ?? null, null);

  return {
    start() {
      // Stop is final: a start that comes after it (will-quit racing activate) must not fork past the only cleanup.
      if (stopped) started ??= Promise.resolve();
      started ??= Promise.all(
        Object.values(hosts).map(
          (host) =>
            new Promise<void>((resolve) => {
              host.settleFirstLaunch = () => {
                host.settleFirstLaunch = () => {};
                resolve();
              };
              // P5 O2 M3: an on-demand host waits for a wake, a request or an adoption
              if (host.spec.onDemand) {
                park(host, true);
                return host.settleFirstLaunch();
              }
              launch(host);
            }),
        ),
      ).then(() => undefined);
      return started;
    },
    stop() {
      if (stopped) return undefined;
      stopped = true;
      const drains: Promise<void>[] = []; // E11
      for (const host of Object.values(hosts)) {
        if (host.restartTimer) clearTimeout(host.restartTimer);
        host.restartTimer = null;
        cancelResync(host, 'transition'); // E10
        const utility = host.utility;
        const drain = host.transport?.stop(); // E10: closes the socket without an exit; the supervisor keeps its sessions
        if (drain) drains.push(drain);
        detach(host, 'was stopped');
        failHeld(host, 'was stopped');
        utility?.child.kill();
        host.settleFirstLaunch();
        settle(host); // P5 O2 M3
      }
      return drains.length === 0 ? undefined : Promise.all(drains).then(() => undefined);
    },
    dispatch,
    snapshot: (owner) => hostOf(owner).state,
    onState(owner, listener) {
      const { listeners } = hostOf(owner);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // C3 start
    onEvent(name, listener) {
      const listeners = eventListeners.get(name) ?? new Set();
      listeners.add(listener as (payload: never) => void);
      eventListeners.set(name, listeners);
      return () => {
        listeners.delete(listener as (payload: never) => void);
      };
    },
    // C3 end
    // E10 start
    setResync(owner, resync) {
      hostOf(owner).resync = resync;
    },
    onStreaming(owner, listener) {
      const { streamingListeners } = hostOf(owner);
      streamingListeners.add(listener);
      return () => streamingListeners.delete(listener);
    },
    streaming: (owner) => hostOf(owner).streaming,
    exitSupervisor(when, owner = 'engine-host') {
      return hosts[owner]?.transport?.exit(when) ?? false;
    },
    expectExit: (owner) => hosts[owner]?.transport?.expectExit() ?? false, // P5 O2 M3
    facts(owner) {
      const host = hostOf(owner);
      return { transport: host.transport ? 'detached' : 'utility', reason: host.reason, refused: host.refused, waitingLiveSessions: host.waitingLiveSessions, lastExit: host.lastExit };
    },
    restartSupervisor({ stopSessions }) {
      const host = hostOf('engine-host');
      if (stopped || host.quitting) return Promise.resolve(notRestartable(host, 'is stopping with the app'));
      return host.transport ? restartDetached(host, host.transport, stopSessions) : restartUtility(host);
    },
    killHeldSupervisor() {
      return hosts['engine-host']?.transport?.killHeld() ?? Promise.resolve(false);
    },
    async stopAllForQuit(graceMs) {
      const host = hostOf('engine-host');
      if (stopped) return;
      if (!host.transport) {
        const result = await dispatch(host.owner, 'engine.shutdown', { graceMs });
        if (!result.ok && result.error.code !== 'unknown_command' && result.error.code !== 'host_unavailable') console.warn('[hosts] engine.shutdown for the quit failed', result.error);
        return;
      }
      host.quitting = true;
      if (host.restartTimer) clearTimeout(host.restartTimer);
      host.restartTimer = null;
      if (!host.transport.quit()) return failHeld(host, 'is stopped for the quit'); // nothing served: nothing to stop
      const result = await dispatch(host.owner, 'host.stopAll', { graceMs });
      if (!result.ok && result.error.code !== 'host_unavailable') console.warn('[hosts] host.stopAll for the quit failed', result.error);
    },
    // E10 end
    // P3-A M4 start
    postDocPort(message, port, owner) {
      const host = hostOf('engine-host');
      if (stopped || host.state.state !== 'ready') return false;
      // P3-A M5: detached, main keeps the host's end and relays it
      if (host.transport) return host.port !== null && (host.relay?.open(message, port, owner ?? null) ?? false);
      if (!host.utility) return false;
      host.utility.postDoc(message, port);
      return true;
    },
    closeDocPorts(owner) {
      hosts['engine-host']?.relay?.closeOwner(owner); // P3-A M5
    },
    // P3-A M4 end
    peer: (owner) => hosts[owner]?.peer ?? null, // P5 O1 M6
    // P5 O2 M3 start
    sayReady(owner) {
      const host = hostOf(owner);
      if (!external(host)) return console.warn(`[hosts] sayReady(${owner}) ignored: its ready line follows its resync`);
      host.readyAsked = true;
      readyIfAsked(host);
    },
    recycle(owner, events = {}) {
      const host = hostOf(owner);
      const transport = host.transport;
      host.readyAsked = false; // a sayReady belonged to the connection that ends here
      // at the drain's end: what the old link never answered fails, and the fresh attempt starts
      const drained = () => {
        failSent(host, 'was recycled');
        events.drained?.();
      };
      if (stopped || host.quitting || !transport || !host.port || !transport.recycle(drained)) {
        events.drained?.();
        return Promise.resolve();
      }
      const welcomed = new Promise<void>((resolve) => host.settled.add(resolve));
      // From here nothing is written on the old link (requests are held for the fresh one), and what the host wrote
      // before it saw the end still arrives through the link's listeners.
      unlink(host);
      host.port = null;
      transition(host, { state: 'restarting', pid: null, restarts: host.state.restarts });
      return welcomed;
    },
    wake(owner) {
      const host = hostOf(owner);
      if (host.parked && !stopped && !host.quitting) launch(host);
    },
    async adopt(owner) {
      const host = hostOf(owner);
      if (!host.transport || !host.parked || stopped || host.quitting) return host.port !== null;
      return host.transport.adopt(); // a welcome reaches `connected`, which unparks the host
    },
    parked: (owner) => hostOf(owner).parked,
    refusal: (owner) => hostOf(owner).refusal,
    forward(owner, { name, input, client }) {
      return new Promise((resolve) => {
        // the host's answer comes through `raw`; one it never gave (unavailable, timed out, failed with its link)
        // through the request's own result, under the id the request took (the relay answers under its client's id)
        const id = String(nextRequestId + 1);
        void request(owner, name, input, null, { client: client ?? null, raw: resolve }).then((result) => {
          if (!result.ok) resolve({ t: 'res', id, ok: false, error: result.error });
        });
      });
    },
    onRaw(owner, listener) {
      const { raw } = hostOf(owner);
      raw.add(listener);
      return () => raw.delete(listener);
    },
    // P5 O2 M3 end
    welcome: (owner) => hostOf(owner).welcome, // P5 O2 M5
    disarmExit: (owner) => hosts[owner]?.transport?.disarmIdle() ?? false, // P5 O2 M5
    expectIdleExit: (owner) => hosts[owner]?.transport?.expectIdleExit() ?? false, // P5 O2 M5
  };
}
