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
import type { HostStatus } from '@shared/ipc/schema/host'; // E10
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
// The host is `ready` while it runs. The signal aborts when the host leaves that connection (reason `transition`) or at
// RESYNC_BOUND_MS (reason `bound`), and the ready line goes without waiting for the resync either way; once it has
// aborted, the dispatch answers `host_unavailable` at once, so no request of a cancelled resync is held for the next
// connection.
export type ResyncCancel = 'transition' | 'bound';
export type HostResync = (dispatch: HostDispatch, signal: AbortSignal) => Promise<void>;

// E10 Task 2.3b: what main knows of a host beyond its HostState, for `host.status` (status.ts). They change only with a
// transition, so `onState` announces them.
export interface HostFacts {
  transport: 'utility' | 'detached';
  reason: HostStatus['reason']; // why `crashed`, when main knows: an incompatible supervisor runs sessions, or a held lock
  refused: 'wire' | 'protocol' | null; // while `incompatible`: what the supervisor's refusal named
  lastExit: { code: number | null; signal: string | null; at: string } | null; // the last unexpected exit this app run
}

export interface HostSupervisor {
  start(): Promise<void>; // idempotent: forks once; resolves when each host's first launch is ready or has given up
  // terminal: kills a utility host (E10: closes a detached engine host's socket with no exit, so its supervisor keeps
  // serving), fails what is pending and held, never restarts; a later start() starts nothing
  stop(): void;
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
  // Asks a detached engine host's supervisor to exit now, or when it holds nothing live; the close that follows is
  // deliberate (no crash count, a fresh start once it is gone). False when the engine host is not detached and served.
  exitSupervisor(when: 'now' | 'idle'): boolean;
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
  resyncing: AbortController | null; // the resync in flight on the current connection
  streaming: boolean; // told `ready` on the current connection
  streamingListeners: Set<() => void>;
  transport: DetachedTransport | null; // a detached host's; null for a utility host
  reason: HostFacts['reason'];
  refused: HostFacts['refused'];
  lastExit: HostFacts['lastExit'];
  quitting: boolean; // stopAllForQuit was asked: nothing restarts, nothing more is held
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
      resyncing: null,
      streaming: false,
      streamingListeners: new Set(),
      transport: null,
      reason: null,
      refused: null,
      lastExit: null,
      quitting: false,
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
    cancelResync(host, 'transition'); // E10: the connection it pulled through is gone (or replaced)
    host.streaming = false; // E10
    if (next.state !== 'crashed') [host.reason, host.refused] = [null, null]; // E10: a reason is a crashed host's
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
    sendHeld(host); // E10: what was asked while the host was restarting goes out on the new port
    forwardOutput(host.owner, child);

    child.on('spawn', () => {
      if (host.child !== child) return;
      transition(host, { state: 'ready', pid: child.pid ?? null, restarts: host.state.restarts });
      host.settleFirstLaunch();
      if (host.resync) sayReady(host, port2); // E10: after the resync, which needs the host ready
      else streaming(host); // E10: told ready at hello, below
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

  function sendHeld(host: Host): void {
    for (const pending of host.pending.values()) if (!pending.sent) send(host, pending);
  }

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
      const { limit, delay } = recordExit(host, exit);
      if (limit) {
        transition(host, { state: 'crashed', pid: host.state.pid, restarts: host.state.restarts });
        host.settleFirstLaunch();
        return;
      }
      transition(host, { state: 'restarting', pid: null, restarts: host.state.restarts + 1 });
      relaunch(delay);
    };
    const crashed = (why: string, reason: HostFacts['reason'] = null, refused: HostFacts['refused'] = null) => {
      console.error(`[hosts] ${host.owner} ${why}`);
      detach(host, 'is unreachable');
      const changed = host.reason !== reason || host.refused !== refused;
      [host.reason, host.refused] = [reason, refused];
      if (host.state.state !== 'crashed' || changed) transition(host, { state: 'crashed', pid: host.state.pid, restarts: host.state.restarts });
      host.settleFirstLaunch();
    };
    return {
      connected(link: HostLink, welcome) {
        if (stopped) return link.close();
        host.port = link;
        link.onMessage((data) => receive(host, data));
        transition(host, { state: 'ready', pid: welcome.pid, restarts: host.state.restarts });
        sendHeld(host);
        host.settleFirstLaunch();
        sayReady(host, link);
      },
      disconnected() {
        if (stopped) return;
        if (host.quitting) return detach(host, 'stopped for the quit'); // the state keeps its pid for the quit's kill rung
        disconnected();
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
        if (!stopped) crashed(`could not be reached${reason === 'held_lock' ? ' (held_lock)' : ''}: ${message}`, reason === 'held_lock' ? 'held_lock' : null);
      },
      waiting(liveSessions, refused) {
        if (!stopped) crashed(`has an incompatible supervisor running ${liveSessions} sessions; waiting for it`, 'incompatible', refused);
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

  // E10 start: host.restart and the quit's stop-all (Task 2.3b)
  const restarted: CommandResult<'host.restart'> = { ok: true, value: undefined };
  const notRestartable = (host: Host, why: string): CommandResult<'host.restart'> => ({ ok: false, error: ipcError('host_unavailable', `${host.owner} ${why}; it cannot be restarted`) });

  async function restartDetached(host: Host, transport: DetachedTransport, stopSessions: boolean): Promise<CommandResult<'host.restart'>> {
    if (host.state.state === 'ready' && host.port) {
      if (!stopSessions) return transport.exit('now') ? restarted : notRestartable(host, 'could not be asked to exit');
      const undo = transport.expectExit(); // its close after the answer is deliberate
      const result = await dispatch(host.owner, 'host.stopAll', { graceMs: STOP_ALL_GRACE_MS });
      if (result.ok) return restarted;
      if (result.error.code !== 'timeout') undo?.(); // past the deadline it may still be stopping, then exit as asked
      return { ok: false, error: result.error };
    }
    if (host.state.state !== 'crashed') return restarted; // starting or restarting: the attempt under way reaches the newest
    // Task 2.4 asks the incompatible supervisor to exit on its refused connection; until then it is waited for
    if (host.reason === 'incompatible') return notRestartable(host, 'waits for an incompatible supervisor');
    if (host.reason === 'held_lock') await transport.killHeld();
    if (stopped || host.quitting) return notRestartable(host, 'is stopping with the app');
    host.exits = []; // asked for: the crash window starts afresh
    transition(host, { state: 'restarting', pid: null, restarts: host.state.restarts });
    transport.launch();
    return restarted;
  }

  // A utility host's sessions end with it whichever way it is restarted, so they are stopped within the grace first.
  async function restartUtility(host: Host): Promise<CommandResult<'host.restart'>> {
    if (host.state.state === 'ready' && host.port) {
      const result = await dispatch(host.owner, 'host.stopAll', { graceMs: STOP_ALL_GRACE_MS });
      if (!result.ok) console.warn(`[hosts] ${host.owner}'s stop-all before its restart failed; restarting it anyway`, result.error);
    }
    if (stopped) return notRestartable(host, 'was stopped');
    if (host.restartTimer) clearTimeout(host.restartTimer);
    host.restartTimer = null;
    host.exits = [];
    const child = host.child;
    detach(host, 'was restarted'); // the old child is no longer the host's: its exit is not a crash
    transition(host, { state: 'restarting', pid: null, restarts: host.state.restarts });
    if (!child) {
      launch(host);
      return restarted;
    }
    child.on('exit', () => {
      if (!stopped) launch(host);
    });
    child.kill();
    return restarted;
  }
  // E10 end

  const dispatch: HostDispatch = (owner, name, input) => {
    const host = hosts[owner];
    // E10: once started, a request made while the host starts or restarts is held and sent when it is ready
    const holds = started !== null && !stopped && !host.quitting && (host.state.state === 'starting' || host.state.state === 'restarting');
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
        cancelResync(host, 'transition'); // E10
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
    onStreaming(owner, listener) {
      hosts[owner].streamingListeners.add(listener);
      return () => hosts[owner].streamingListeners.delete(listener);
    },
    streaming: (owner) => hosts[owner].streaming,
    exitSupervisor(when) {
      return hosts['engine-host']?.transport?.exit(when) ?? false;
    },
    facts(owner) {
      const host = hosts[owner];
      return { transport: host.transport ? 'detached' : 'utility', reason: host.reason, refused: host.refused, lastExit: host.lastExit };
    },
    restartSupervisor({ stopSessions }) {
      const host = hosts['engine-host'];
      if (stopped || host.quitting) return Promise.resolve(notRestartable(host, 'is stopping with the app'));
      return host.transport ? restartDetached(host, host.transport, stopSessions) : restartUtility(host);
    },
    killHeldSupervisor() {
      return hosts['engine-host']?.transport?.killHeld() ?? Promise.resolve(false);
    },
    async stopAllForQuit(graceMs) {
      const host = hosts['engine-host'];
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
  };
}

// The hosts' stdout and stderr, line by line into main's log, prefixed with the host.
function forwardOutput(owner: HostOwner, child: UtilityProcess): void {
  if (child.stdout) createInterface({ input: child.stdout }).on('line', (line) => console.log(`[${owner}] ${line}`));
  if (child.stderr) createInterface({ input: child.stderr }).on('line', (line) => console.error(`[${owner}] ${line}`));
}
