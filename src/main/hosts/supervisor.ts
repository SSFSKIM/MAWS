// Main's side of the utility processes (charter §4.1; §12 C1 *Utility processes, build and start*). The supervisor
// forks the engine host and the PTY host once, speaks the host protocol to each over its own MessageChannelMain port,
// restarts a host that dies unexpectedly, and answers for a host's state itself, so a crashed host still reports.
// Hosts are app-scoped: nothing here knows about windows or pages, so a renderer reload never touches them.
import { createInterface } from 'node:readline';
import { app, MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';
import { ipcError } from '@shared/ipc/errors';
import { HostToMainSchema, type HostMessage, type HostResponse } from '@shared/ipc/host-protocol';
import type { CommandName, CommandResult, EventName, EventPayload, HostState, PtyId } from '@shared/ipc/schema';
import { isEventName, validateCommandOutput } from '@shared/ipc/validate';
import type { HostDispatch, HostOwner } from '../ipc/router';

export interface HostSpec {
  modulePath: string; // the bundled entry, from electron-vite's `?modulePath` import
  serviceName: string; // the name `app.getAppMetrics()` reports for the process
}

export interface HostSupervisorOptions {
  hosts: Record<HostOwner, HostSpec>;
  emit: <N extends EventName>(name: N, payload: EventPayload<N>) => boolean; // relays host events to the renderer
}

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
}

export const REQUEST_TIMEOUT_MS = 10_000;
// The wait before the 1st, 2nd and 3rd-and-later restart of a host since app start.
export const RESTART_BACKOFF_MS = [500, 2_000, 5_000] as const;
// This many unexpected exits within the window leave a host `crashed` for good.
export const CRASH_LIMIT = 3;
export const CRASH_WINDOW_MS = 60_000;

interface Pending {
  name: CommandName;
  resolve: (result: CommandResult<CommandName>) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Host {
  owner: HostOwner;
  spec: HostSpec;
  state: HostState;
  child: UtilityProcess | null;
  port: MessagePortMain | null;
  pending: Map<string, Pending>;
  exits: number[]; // times of unexpected exits inside the crash window
  restartTimer: ReturnType<typeof setTimeout> | null;
  listeners: Set<(state: HostState) => void>;
  settleFirstLaunch: () => void;
  // PTY host only: the ptys the renderer was told about and not yet told have exited. When the host dies they die
  // with it, and the supervisor is the one left to say so.
  ptys: Set<string>;
}

export function createHostSupervisor({ hosts: specs, emit }: HostSupervisorOptions): HostSupervisor {
  const hosts = {} as Record<HostOwner, Host>;
  for (const owner of Object.keys(specs) as HostOwner[]) {
    hosts[owner] = {
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
    };
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
    for (const listener of host.listeners) listener(host.state);
  }

  function launch(host: Host): void {
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
  }

  function detach(host: Host, reason: string): void {
    host.child = null;
    host.port?.close();
    host.port = null;
    for (const [id, pending] of host.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: ipcError('host_unavailable', `${host.owner} ${reason} before answering ${pending.name}`) });
      host.pending.delete(id);
    }
  }

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
    const delay = RESTART_BACKOFF_MS[Math.min(host.state.restarts, RESTART_BACKOFF_MS.length - 1)];
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
    const port = host.port;
    if (!port) {
      return Promise.resolve({ ok: false, error: ipcError('host_unavailable', `${owner} is ${host.state.state}; cannot answer ${name}`) });
    }
    const id = String(++nextRequestId);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        host.pending.delete(id);
        resolve({ ok: false, error: ipcError('timeout', `${owner} did not answer ${name} within ${REQUEST_TIMEOUT_MS / 1000} s`) });
      }, REQUEST_TIMEOUT_MS);
      host.pending.set(id, { name, resolve, timer });
      port.postMessage({ t: 'req', id, name, input } satisfies HostMessage);
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
        detach(host, 'was stopped');
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
  };
}

// The hosts' stdout and stderr, line by line into main's log, prefixed with the host.
function forwardOutput(owner: HostOwner, child: UtilityProcess): void {
  if (child.stdout) createInterface({ input: child.stdout }).on('line', (line) => console.log(`[${owner}] ${line}`));
  if (child.stderr) createInterface({ input: child.stderr }).on('line', (line) => console.error(`[${owner}] ${line}`));
}
