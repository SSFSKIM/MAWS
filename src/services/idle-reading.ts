// The spine's idle reading (P5 O3-C, docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §F; D18):
// the subject of e2e:daemon-idle-spine, O3 §11's diagnostic reading of what O3-D moves into `mawsd`, before it moves.
// The spine composed alone over `profile`, as `mawsd`'s root will compose it, with stand-in ports: an engine host that
// never connects (it never streams, and answers every dispatch `host_unavailable`), a bus no client is connected to, a
// client port that answers `noClient`, an empty interest set, no browser socket, no trash, and process.env as the
// shell's capture. With no host, nothing the spine does at a connect runs: what is measured is the spine holding the
// profile's data, idle.
//
// It logs `spine idle: composed` with the records and projects the view reads once `startSpine` has returned, and when
// released (SIGUSR2 by default; a test passes its own trigger) stops the root, drops every reference to it, runs
// globalThis.gc twice when the runtime exposes it (`--expose-gc`), and logs `spine idle: released` with whether it
// did. A timer keeps the process alive until `dispose`. `spine.lock` stays held, as `openSpineData` holds it, until the
// process exits.
import { hostname } from 'node:os';
import { NO_CLIENT, type ClientPort } from '@shared/client/port';
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName, EventName } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import type { ServicesBus } from '@shared/spine/bus';
import { startMachineIdentity } from './machine/identity';
import { openSpineData, startSpine, type SpineHosts, type SpineRoot } from './spine-root';

const KEEP_ALIVE_MS = 1 << 30;

export interface IdleReadingOptions {
  profile: string;
  build: string;
  log(line: string): void;
  onRelease?(release: () => void): void; // default: process.once('SIGUSR2', release)
}

export interface IdleReading {
  released: Promise<void>; // once the root has stopped and, when the runtime exposes it, gc has run
  dispose(): void; // ends the keep-alive (and the SIGUSR2 listener when it was never fired)
}

export async function idleReading({ profile, build, log, onRelease }: IdleReadingOptions): Promise<IdleReading> {
  const keepAlive = setInterval(() => {}, KEEP_ALIVE_MS);
  let bus: ServicesBus | null = clientlessBus();
  const machine = startMachineIdentity({ userData: profile, env: process.env, hostname: hostname(), register: bus.register }).ref;
  const data = await openSpineData(profile, { build });
  let root: SpineRoot | null = startSpine({
    profile,
    machine,
    data,
    hosts: unconnectedHost(),
    bus,
    clientPort: noClientPort,
    interest: () => new Set<AppSessionId>(),
    browserSocket: () => null,
    trash: (path) => Promise.reject(new Error(`the idle reading trashes nothing (${path})`)),
    engineEnv: Promise.resolve(process.env as Record<string, string>),
    env: process.env,
    packaged: true,
    appPath: profile, // no checkout above it: no replay fixtures, as a packaged app has none
    devRoot: profile,
    home: process.env.HOME ?? profile,
  });
  const view = root.view;
  log(`spine idle: composed: ${view.records().length} sessions in ${view.projects().length} projects${data.refused === null ? '' : `, refused: ${data.refused}`}`);

  let markReleased!: () => void;
  const released = new Promise<void>((resolve) => (markReleased = resolve));
  const release = () => {
    if (root === null) return;
    root.stop();
    root = null;
    bus = null; // its handlers close over every part of the spine
    void collected().then((gc) => {
      log(`spine idle: released (gc: ${gc})`);
      markReleased();
    });
  };
  const signalled = onRelease === undefined;
  if (signalled) process.once('SIGUSR2', release);
  else onRelease(release);
  return {
    released,
    dispose: () => {
      clearInterval(keepAlive);
      if (signalled) process.removeListener('SIGUSR2', release);
    },
  };
}

// Two full collections, a turn of the event loop before each so what the stop scheduled has run; false when the runtime
// exposes no gc
async function collected(): Promise<boolean> {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== 'function') return false;
  for (let n = 0; n < 2; n += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    gc();
  }
  return true;
}

// The engine host before it ever connects: starting, never streaming, every dispatch unanswered
function unconnectedHost(): SpineHosts {
  const none = () => () => {};
  return {
    dispatch: async (_owner, command) => ({ ok: false, error: ipcError('host_unavailable', `no engine host in the idle reading (${command})`) }),
    onEvent: none,
    onState: none,
    onStreaming: none,
    streaming: () => false,
    snapshot: () => ({ state: 'starting', pid: null, restarts: 0, revision: 0 }),
    setResync: () => {},
  };
}

// The services bus with no client connected: commands registered (none is ever asked), intercepts installed, and each
// event validated and heard by the spine's own taps
function clientlessBus(): ServicesBus {
  const handlers = new Map<CommandName, unknown>();
  const intercepts = new Map<CommandName, unknown>();
  const taps = new Map<EventName, Set<(payload: unknown) => void>>();
  return {
    register: (name, handler) => {
      if (handlers.has(name)) throw new Error(`a handler for ${name} is already registered`);
      handlers.set(name, handler);
    },
    intercept: (name, handler) => {
      intercepts.set(name, handler);
      return () => {
        if (intercepts.get(name) === handler) intercepts.delete(name);
      };
    },
    emit: (name, payload) => {
      const checked = validateEventPayload(name, payload);
      if (!checked.ok) return false;
      for (const tap of [...(taps.get(name) ?? [])]) tap(checked.value);
      return true;
    },
    onEmitted: (name, listener) => {
      let set = taps.get(name);
      if (!set) taps.set(name, (set = new Set()));
      const entry = listener as (payload: unknown) => void;
      set.add(entry);
      return () => void set.delete(entry);
    },
  };
}

const noClientPort: ClientPort = {
  pick: async () => NO_CLIENT,
  save: async () => NO_CLIENT,
  confirm: async () => NO_CLIENT,
  reveal: async () => NO_CLIENT,
  openExternal: async () => NO_CLIENT,
  notify: () => NO_CLIENT,
  badge: () => NO_CLIENT,
  focus: () => NO_CLIENT,
};
