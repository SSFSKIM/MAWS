// Main's side of the utility processes (charter §4.1; §12 C1 *Utility processes, build and start*). The supervisor
// forks the engine host and the PTY host once, speaks the host protocol to each over its own MessageChannelMain port,
// restarts a host that dies unexpectedly, and answers for a host's state itself, so a crashed host still reports.
// Hosts are app-scoped: nothing here knows about windows or pages, so a renderer reload never touches them.
// E10: a host's spec names its transport. `utility` is the fork above, unchanged; `detached` reaches the engine host
// as a supervisor process that outlives the app, over a Unix socket (detached-transport.ts). Both say the host
// protocol's `ready` line after the host's resync (if one is registered), and hold requests made while the host is
// starting or restarting until it is ready.
import { createInterface } from 'node:readline';
import { app, MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron';
import { ipcError } from '@shared/ipc/errors';
import { HostToMainSchema, type HostMessage, type HostResponse } from '@shared/ipc/host-protocol';
import type { CommandName, CommandResult, EventName, EventPayload, HostState, PtyId } from '@shared/ipc/schema';
import { isEventName, validateCommandOutput } from '@shared/ipc/validate';
import type { HostDispatch, HostOwner } from '../ipc/router';
// E10 start
import { createDetachedTransport, type DetachedEvents, type DetachedTransport, type DetachedTransportOptions, type ExitInfo, type HostLink } from './detached-transport';
// E10 end

export interface HostSpec {
  modulePath: string; // the bundled entry, from electron-vite's `?modulePath` import
  serviceName: string; // the name `app.getAppMetrics()` reports for the process
  transport?: 'utility' | 'detached'; // E10: `utility` unless said otherwise; only the engine host runs detached
}

export interface HostSupervisorOptions {
  hosts: Record<HostOwner, HostSpec>;
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => boolean; // relays host events to the renderer
  // E10 start
  // The detached transport's facts and seams; userData and packaged default to Electron's.
  detached?: Partial<Omit<DetachedTransportOptions, 'modulePath'>>;
  restartBackoffMs?: readonly number[]; // RESTART_BACKOFF_MS unless a test shortens it
  // E10 end
}

// E10: what main pulls from a host between its connect and its `ready` line (X13: the host emits nothing before it).
// The dispatch is the supervisor's own; the host is `ready` while it runs.
export type HostResync = (dispatch: HostDispatch) => Promise<void>;

export interface HostSupervisor {
  start(): Promise<void>; // idempotent: forks once; resolves when each host's first launch is ready or has given up
  stop(): void; // terminal: kills both hosts, fails what is pending, never restarts; a later start() forks nothing
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
  // Asks a detached engine host's supervisor to exit now, or when it holds nothing live; the close that follows is
  // deliberate (no crash count, a fresh start once it is gone). False when the engine host is not detached and served.
  exitSupervisor(when: 'now' | 'idle'): boolean;
  // E10 end
}

export const REQUEST_TIMEOUT_MS = 10_000;
// The wait before the 1st, 2nd and 3rd-and-later restart of a host since app start.
export const RESTART_BACKOFF_MS = [500, 2_000, 5_000] as const;
// This many unexpected exits within the window leave a host `crashed` for good.
export const CRASH_LIMIT = 3;
export const CRASH_WINDOW_MS = 60_000;
// E10: past this the `ready` line goes without the resync's answer (the resync logs what it left undone).
export const RESYNC_BOUND_MS = 30_000;

interface Pending {
  name: CommandName;
  resolve: (result: CommandResult<CommandName>) => void;
  timer: ReturnType<typeof setTimeout>;
  request: HostMessage; // E10: kept until it is sent: a request made while the host starts is held
  sent: boolean;
}

// E10: the port a host is spoken to through, a MessagePortMain or the detached transport's socket link.
interface MainPort {
  postMessage(message: HostMessage): void;
  close(): void;
}

interface Host {
  owner: HostOwner;
  spec: HostSpec;
  state: HostState;
  child: UtilityProcess | null;
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
  transport: DetachedTransport | null; // a detached host's; null for a utility host
  // E10 end
}

export function createHostSupervisor({ hosts: specs, emit, detached, restartBackoffMs = RESTART_BACKOFF_MS }: HostSupervisorOptions): HostSupervisor {
  const hosts = {} as Record<HostOwner, Host>;
  for (const owner of Object.keys(specs) as HostOwner[]) {
    const host: Host = {
      owner,
      spec: specs[owner],
      state: { state: 'starting', pid: null, restarts: 0, revision: 0 },
      child: null,
      port: null,
      pending: new Map(),
      exits: [],
      restartTimer: null,
      listeners: new Set(),
      settleFirstLaunch: () => {},
      ptys: new Set(),
      resync: null,
      transport: null,
    };
    // E10: a detached host's transport, reporting into the same state, ladder and requests as a utility host's
    if (host.spec.transport === 'detached') {
      const options = { userData: () => app.getPath('userData'), packaged: () => app.isPackaged, ...detached, modulePath: host.spec.modulePath };
      host.transport = createDetachedTransport(options, detachedEvents(host));
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
    host.state = { ...next, revision: host.state.revision + 1 };
    if (next.state === 'crashed') failHeld(host, 'is crashed'); // E10: a held request fails only on crashed or stop()
    for (const listener of host.listeners) listener(host.state);
  }

  function launch(host: Host): void {
    if (host.transport) return host.transport.launch(); // E10: a detached host is reached by its transport
    const { port1, port2 } = new MessageChannelMain();
    let child: UtilityProcess;
    if (app.isPackaged) delete process.env.MAWS_RELAY_URL; // C11: the dev-only relay override (M6) never reaches a packaged host
    try {
      child = utilityProcess.fork(host.spec.modulePath, [], { serviceName: host.spec.serviceName, stdio: 'pipe' });
    } catch (error) {
      console.error(`[hosts] could not fork ${host.owner}`, error);
      port1.close();
      port2.close();
      exited(host, null);
      return;
    }
    host.child = child;
    host.port = port2;
    forwardOutput(host.owner, child);

    child.on('spawn', () => {
      if (host.child !== child) return;
      transition(host, { state: 'ready', pid: child.pid ?? null, restarts: host.state.restarts });
      host.settleFirstLaunch();
      if (host.resync) sayReady(host, port2); // E10: after the resync, which needs the host ready
    });
    child.on('error', (type, location) => {
      if (host.child === child) console.error(`[hosts] ${host.owner} fatal error ${type} at ${location}`);
    });
    child.on('exit', (code) => {
      if (host.child === child) exited(host, code);
    });

    port2.on('message', ({ data }) => receive(host, data));
    port2.start();
    child.postMessage({ t: 'hello' } satisfies HostMessage, [port1]);
    // E10: the host emits no event before main's ready line (X13). A host with nothing to pull (the pty host) is told
    // at once, so the port delivers it ahead of every request; one with a resync is told once the resync is done.
    if (!host.resync) port2.postMessage({ t: 'ready' } satisfies HostMessage);
  }

  // E10: the `ready` line, after the host's resync (bounded by RESYNC_BOUND_MS), on the port it was pulled through: a
  // host that left `ready` meanwhile is not told.
  function sayReady(host: Host, port: MainPort): void {
    const resync = host.resync;
    if (!resync) return port.postMessage({ t: 'ready' });
    let bound: ReturnType<typeof setTimeout> | undefined;
    const bounded = new Promise<void>((resolve) => {
      bound = setTimeout(() => {
        console.error(`[hosts] ${host.owner}'s resync took longer than ${RESYNC_BOUND_MS / 1000} s; saying ready without it`);
        resolve();
      }, RESYNC_BOUND_MS);
    });
    const pulled = Promise.resolve()
      .then(() => resync(dispatch))
      .catch((error: unknown) => console.error(`[hosts] ${host.owner}'s resync failed`, error));
    void Promise.race([pulled, bounded]).then(() => {
      clearTimeout(bound);
      if (host.port === port) port.postMessage({ t: 'ready' });
    });
  }

  // Fails the requests the host was sent; E10: the ones still held wait for the next connect.
  function detach(host: Host, reason: string): void {
    host.child = null;
    host.port?.close();
    host.port = null;
    for (const [id, pending] of host.pending) {
      if (!pending.sent) continue;
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: ipcError('host_unavailable', `${host.owner} ${reason} before answering ${pending.name}`) });
      host.pending.delete(id);
    }
  }

  // E10 start
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
    host.port!.postMessage(pending.request);
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
      const now = Date.now();
      host.exits = [...host.exits.filter((at) => now - at < CRASH_WINDOW_MS), now];
      if (host.exits.length >= CRASH_LIMIT) {
        console.error(`[hosts] ${host.owner} exited ${host.exits.length} times within ${CRASH_WINDOW_MS / 1000} s; not restarting`);
        transition(host, { state: 'crashed', pid: host.state.pid, restarts: host.state.restarts });
        host.settleFirstLaunch();
        return;
      }
      const delay = restartBackoffMs[Math.min(host.state.restarts, restartBackoffMs.length - 1)];
      transition(host, { state: 'restarting', pid: null, restarts: host.state.restarts + 1 });
      relaunch(delay);
    };
    const crashed = (why: string) => {
      console.error(`[hosts] ${host.owner} ${why}`);
      detach(host, 'is unreachable');
      if (host.state.state !== 'crashed') transition(host, { state: 'crashed', pid: host.state.pid, restarts: host.state.restarts });
      host.settleFirstLaunch();
    };
    return {
      connected(link: HostLink, welcome) {
        if (stopped) return link.close();
        host.port = link;
        link.onMessage((data) => receive(host, data));
        transition(host, { state: 'ready', pid: welcome.pid, restarts: host.state.restarts });
        for (const pending of host.pending.values()) if (!pending.sent) send(host, pending);
        host.settleFirstLaunch();
        sayReady(host, link);
      },
      disconnected() {
        if (!stopped) disconnected();
      },
      lost(loss) {
        if (stopped) return;
        if (loss === 'replaced') return crashed('was taken over by another client of its supervisor; not reconnecting');
        disconnected();
        if (loss === 'quiet') return relaunch(restartBackoffMs[0]);
        if (loss === 'deliberate') return launch(host);
        unexpected(loss.crash);
      },
      exited(exit) {
        if (!stopped) unexpected(exit);
      },
      failed(reason, message) {
        if (!stopped) crashed(`could not be reached${reason === 'held_lock' ? ' (held_lock)' : ''}: ${message}`);
      },
      waiting(liveSessions) {
        if (!stopped) crashed(`has an incompatible supervisor running ${liveSessions} sessions; waiting for it`);
      },
    };
  }
  // E10 end

  function exited(host: Host, code: number | null): void {
    detach(host, 'exited');
    if (stopped) return;
    console.error(`[hosts] ${host.owner} exited unexpectedly (code ${code})`);
    for (const ptyId of host.ptys) emit('pty.exit', { ptyId: ptyId as PtyId, exitCode: null, signal: null });
    host.ptys.clear();

    const now = Date.now();
    host.exits = [...host.exits.filter((at) => now - at < CRASH_WINDOW_MS), now];
    transition(host, { state: 'crashed', pid: host.state.pid, restarts: host.state.restarts });
    if (host.exits.length >= CRASH_LIMIT) {
      console.error(`[hosts] ${host.owner} exited ${host.exits.length} times within ${CRASH_WINDOW_MS / 1000} s; not restarting`);
      host.settleFirstLaunch();
      return;
    }
    const delay = restartBackoffMs[Math.min(host.state.restarts, restartBackoffMs.length - 1)];
    host.restartTimer = setTimeout(() => {
      host.restartTimer = null;
      transition(host, { state: 'restarting', pid: null, restarts: host.state.restarts + 1 });
      launch(host);
    }, delay);
  }

  function receive(host: Host, data: unknown): void {
    const message = HostToMainSchema.safeParse(data);
    if (!message.success) {
      console.error(`[hosts] dropped a malformed message from ${host.owner}`, message.error.issues);
      return;
    }
    if (message.data.t === 'evt') {
      const { name, payload } = message.data;
      if (!isEventName(name)) {
        console.error(`[hosts] dropped ${host.owner}'s event ${name}: not in the event registry`);
        return;
      }
      const relayed = emit(name, payload as never);
      if (relayed && name === 'pty.exit') host.ptys.delete((payload as { ptyId: string }).ptyId);
      if (relayed) notifyEvent(name, payload); // C3: emit validated it, and validators never transform
      return;
    }
    answer(host, message.data);
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
    const output = validateCommandOutput(pending.name, response.value);
    if (!output.ok) {
      console.error(`[hosts] ${host.owner} answered ${pending.name} with an invalid output`, output.error.issues);
      pending.resolve({ ok: false, error: ipcError('internal', output.error.message, output.error.issues) });
      return;
    }
    if (pending.name === 'pty.spawn') host.ptys.add((output.value as { ptyId: string }).ptyId);
    pending.resolve(output);
  }

  const dispatch: HostDispatch = (owner, name, input) => {
    const host = hosts[owner];
    // E10: once started, a request made while the host starts or restarts is held and sent when it is ready
    const holds = started !== null && !stopped && (host.state.state === 'starting' || host.state.state === 'restarting');
    if (!host.port && !holds) {
      return Promise.resolve({ ok: false, error: ipcError('host_unavailable', `${owner} is ${host.state.state}; cannot answer ${name}`) });
    }
    const id = String(++nextRequestId);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        host.pending.delete(id);
        resolve({ ok: false, error: ipcError('timeout', `${owner} did not answer ${name} within ${REQUEST_TIMEOUT_MS / 1000} s`) });
      }, REQUEST_TIMEOUT_MS);
      const pending: Pending = { name, resolve, timer, request: { t: 'req', id, name, input }, sent: false };
      host.pending.set(id, pending);
      if (host.port) send(host, pending);
    });
  };

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
              launch(host);
            }),
        ),
      ).then(() => undefined);
      return started;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const host of Object.values(hosts)) {
        if (host.restartTimer) clearTimeout(host.restartTimer);
        host.restartTimer = null;
        const child = host.child;
        host.transport?.stop(); // E10: closes the socket without an exit; the supervisor keeps its sessions
        detach(host, 'was stopped');
        failHeld(host, 'was stopped');
        child?.kill();
        host.settleFirstLaunch();
      }
    },
    dispatch,
    snapshot: (owner) => hosts[owner].state,
    onState(owner, listener) {
      hosts[owner].listeners.add(listener);
      return () => hosts[owner].listeners.delete(listener);
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
      hosts[owner].resync = resync;
    },
    exitSupervisor(when) {
      return hosts['engine-host']?.transport?.exit(when) ?? false;
    },
    // E10 end
  };
}

// The hosts' stdout and stderr, line by line into main's log, prefixed with the host.
function forwardOutput(owner: HostOwner, child: UtilityProcess): void {
  if (child.stdout) createInterface({ input: child.stdout }).on('line', (line) => console.log(`[${owner}] ${line}`));
  if (child.stderr) createInterface({ input: child.stderr }).on('line', (line) => console.error(`[${owner}] ${line}`));
}
