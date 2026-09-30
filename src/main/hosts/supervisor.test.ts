import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createHostRuntime, type HostPort } from '@shared/host/runtime';

// Electron is faked. A fork returns a child that spawns when the test says so; a MessageChannelMain is a pair of
// ports delivering to each other on a microtask, like the real ones. The real host runtime serves the port a child
// receives with its hello, so both ends of the host protocol are exercised together.
const electron = vi.hoisted(() => {
  type Listener = (event: { data: unknown }) => void;
  class FakePort {
    peer: FakePort | null = null;
    listeners: Listener[] = [];
    closed = false;
    on(_event: 'message', listener: Listener) {
      this.listeners.push(listener);
      return this;
    }
    postMessage(data: unknown) {
      const peer = this.peer;
      if (this.closed || !peer) return;
      queueMicrotask(() => {
        if (!peer.closed) peer.listeners.forEach((l) => l({ data: structuredClone(data) }));
      });
    }
    start() {}
    close() {
      this.closed = true;
    }
  }
  class FakeChild {
    pid: number | undefined = undefined;
    hello: { message: unknown; port: FakePort } | null = null;
    killed = false;
    relayOverride: string | undefined = undefined; // C11
    private handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    stdout = null;
    stderr = null;
    constructor(
      public modulePath: string,
      public args: string[],
      public options: Record<string, unknown>,
    ) {}
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    fire(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.forEach((h) => h(...args));
    }
    postMessage(message: unknown, transfer: FakePort[] = []) {
      this.hello = { message, port: transfer[0] };
    }
    spawn(pid: number) {
      this.pid = pid;
      this.fire('spawn');
    }
    exit(code = 1) {
      this.pid = undefined;
      this.fire('exit', code);
    }
    kill() {
      this.killed = true;
      queueMicrotask(() => this.exit(0));
      return true;
    }
  }
  const forks: FakeChild[] = [];
  const app = { isPackaged: false }; // C11: the relay override's packaged-mode pin
  return { FakePort, FakeChild, forks, app };
});

vi.mock('electron', () => ({
  app: electron.app, // C11
  utilityProcess: {
    fork: (modulePath: string, args: string[], options: Record<string, unknown>) => {
      const child = new electron.FakeChild(modulePath, args, options);
      child.relayOverride = process.env.MAWS_RELAY_URL; // C11: what the forked host inherits
      electron.forks.push(child);
      return child;
    },
  },
  MessageChannelMain: class {
    port1 = new electron.FakePort();
    port2 = new electron.FakePort();
    constructor() {
      this.port1.peer = this.port2;
      this.port2.peer = this.port1;
    }
  },
}));

import { createHostSupervisor, type HostSupervisor } from './supervisor';

const HOSTS = {
  'engine-host': { modulePath: '/out/main/engine-host.js', serviceName: 'maws-engine-host' },
  'pty-host': { modulePath: '/out/main/pty-host.js', serviceName: 'maws-pty-host' },
} as const;

const forksOf = (serviceName: string) => electron.forks.filter((c) => c.options.serviceName === serviceName);
const latest = (serviceName: string) => forksOf(serviceName).at(-1)!;
const flush = () => vi.advanceTimersByTimeAsync(0);

// Plays the host: serves the port the child was handed with its hello, with the real runtime.
function serve(child: InstanceType<typeof electron.FakeChild>, register: Parameters<typeof createHostRuntime>[0]) {
  expect(child.hello?.message).toEqual({ t: 'hello' });
  createHostRuntime(register).serve(child.hello!.port as unknown as HostPort);
}

// Posts a raw message from the host's end of a child's port.
const fromHost = (child: InstanceType<typeof electron.FakeChild>, message: unknown) => child.hello!.port.postMessage(message);

const PING = (pid: number) => ({ pid, uptimeMs: 1, hostVersion: 'test' });

let emit: Mock<(name: string, payload: unknown) => boolean>;
let supervisor: HostSupervisor;

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  electron.forks.length = 0;
  emit = vi.fn<(name: string, payload: unknown) => boolean>(() => true);
  supervisor = createHostSupervisor({ hosts: HOSTS, emit });
});

afterEach(() => {
  supervisor.stop();
  vi.useRealTimers();
});

// Starts both hosts and brings them to ready with the given pids, each serving a ping.
async function startReady(enginePid = 101, ptyPid = 202) {
  void supervisor.start();
  const engine = latest('maws-engine-host');
  const pty = latest('maws-pty-host');
  serve(engine, (on) => on('engine.ping', async () => PING(enginePid)));
  serve(pty, (on) => on('pty.ping', async () => PING(ptyPid)));
  engine.spawn(enginePid);
  pty.spawn(ptyPid);
  await flush();
  return { engine, pty };
}

describe('host supervisor', () => {
  it('forks each host once, however often start() is called', async () => {
    const first = supervisor.start();
    const second = supervisor.start();
    expect(second).toBe(first);
    expect(electron.forks).toHaveLength(2);
    expect(forksOf('maws-engine-host')[0]).toMatchObject({ modulePath: HOSTS['engine-host'].modulePath, args: [] });
    expect(forksOf('maws-engine-host')[0].options).toEqual({ serviceName: 'maws-engine-host', stdio: 'pipe' });
    expect(forksOf('maws-pty-host')[0].options).toEqual({ serviceName: 'maws-pty-host', stdio: 'pipe' });
    latest('maws-engine-host').spawn(1);
    latest('maws-pty-host').spawn(2);
    await expect(first).resolves.toBeUndefined();
    void supervisor.start();
    expect(electron.forks).toHaveLength(2);
  });

  it('forks nothing when start() follows stop(), and settles at once (will-quit racing activate)', async () => {
    supervisor.stop();
    await expect(supervisor.start()).resolves.toBeUndefined();
    expect(electron.forks).toHaveLength(0);
    await expect(supervisor.dispatch('engine-host', 'engine.ping', undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'host_unavailable' },
    });
  });

  it('hands each host its port with the hello', () => {
    void supervisor.start();
    for (const child of electron.forks) {
      expect(child.hello?.message).toEqual({ t: 'hello' });
      expect(child.hello?.port).toBeInstanceOf(electron.FakePort);
    }
  });

  it('reports starting, then ready with the pid, on every transition with a rising revision', async () => {
    const seen: unknown[] = [];
    supervisor.onState('engine-host', (state) => seen.push(state));
    expect(supervisor.snapshot('engine-host')).toEqual({ state: 'starting', pid: null, restarts: 0, revision: 0 });
    await startReady(101);
    expect(supervisor.snapshot('engine-host')).toEqual({ state: 'ready', pid: 101, restarts: 0, revision: 1 });
    expect(seen).toEqual([{ state: 'ready', pid: 101, restarts: 0, revision: 1 }]);
  });

  it('dispatches a command to its owner and answers the host’s reply', async () => {
    await startReady(101, 202);
    await expect(supervisor.dispatch('engine-host', 'engine.ping', undefined)).resolves.toEqual({ ok: true, value: PING(101) });
    await expect(supervisor.dispatch('pty-host', 'pty.ping', undefined)).resolves.toEqual({ ok: true, value: PING(202) });
  });

  it('answers unknown_command when the host does not know the name', async () => {
    await startReady();
    await expect(supervisor.dispatch('engine-host', 'nope.thing' as never, undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'unknown_command' },
    });
  });

  it('logs and drops a response for an unknown id, and a malformed message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine } = await startReady();
    fromHost(engine, { t: 'res', id: 'never-asked', ok: true, value: 1 });
    fromHost(engine, { t: 'wibble' });
    await flush();
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0].join(' ')).toContain('never-asked');
    await expect(supervisor.dispatch('engine-host', 'engine.ping', undefined)).resolves.toMatchObject({ ok: true });
  });

  it('answers internal when the host replies with an output the command’s schema refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    void supervisor.start();
    const engine = latest('maws-engine-host');
    engine.hello!.port.on('message', ({ data }) => {
      const req = data as { id: string };
      fromHost(engine, { t: 'res', id: req.id, ok: true, value: { pid: 'not a number' } });
    });
    engine.spawn(5);
    await expect(supervisor.dispatch('engine-host', 'engine.ping', undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });

  it('fails a request the host never answers with timeout after 10 s', async () => {
    void supervisor.start();
    latest('maws-engine-host').spawn(5); // spawned, but nobody serves the port
    const reply = supervisor.dispatch('engine-host', 'engine.ping', undefined);
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void reply.then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(reply).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
  });

  it('relays host events to the renderer and drops events outside the registry', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pty } = await startReady();
    const data = new Uint8Array([104, 105]);
    fromHost(pty, { t: 'evt', name: 'pty.data', payload: { ptyId: 'p1', offset: 0, data } });
    fromHost(pty, { t: 'evt', name: 'nope.thing', payload: {} });
    await flush();
    expect(emit).toHaveBeenCalledExactlyOnceWith('pty.data', { ptyId: 'p1', offset: 0, data });
    expect(log).toHaveBeenCalledOnce();
  });

  // C3 start: main-side subscription to validated host events (wave-2 ledger (b); C3's attention service, C4's index)
  it('onEvent hands each validated host event to its listeners by name, after relaying it, until unsubscribed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pty } = await startReady();
    const seen: unknown[] = [];
    const exits: unknown[] = [];
    const off = supervisor.onEvent('pty.data', (payload) => seen.push(payload));
    supervisor.onEvent('pty.exit', (payload) => exits.push(payload));
    supervisor.onEvent('pty.data', () => {
      throw new Error('a faulty listener');
    });
    emit.mockImplementation((name, payload) => (payload as { data?: unknown }).data !== 'invalid'); // main's emit refuses what fails X2
    fromHost(pty, { t: 'evt', name: 'pty.data', payload: { ptyId: 'p1', data: 'hi' } });
    fromHost(pty, { t: 'evt', name: 'pty.data', payload: { ptyId: 'p1', data: 'invalid' } });
    await flush();
    expect(seen).toEqual([{ ptyId: 'p1', data: 'hi' }]);
    expect(exits).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pty.data'), expect.any(Error));
    off();
    fromHost(pty, { t: 'evt', name: 'pty.data', payload: { ptyId: 'p1', data: 'again' } });
    await flush();
    expect(seen).toHaveLength(1);
  });
  // C3 end

  it('on a crash fails pending requests with host_unavailable, reports crashed, then restarts after 0.5 s', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine } = await startReady(101);
    const readyRevision = supervisor.snapshot('engine-host').revision;
    // A request the host has not answered yet when it dies.
    const replacementHost = vi.fn();
    engine.hello!.port.listeners.length = 0;
    engine.hello!.port.on('message', replacementHost);
    const pending = supervisor.dispatch('engine-host', 'engine.ping', undefined);
    await flush();
    expect(replacementHost).toHaveBeenCalledOnce();

    engine.exit(137);
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    const crashed = supervisor.snapshot('engine-host');
    expect(crashed).toMatchObject({ state: 'crashed', pid: 101, restarts: 0 });
    expect(crashed.revision).toBeGreaterThan(readyRevision);
    await expect(supervisor.dispatch('engine-host', 'engine.ping', undefined)).resolves.toMatchObject({
      error: { code: 'host_unavailable' },
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(forksOf('maws-engine-host')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(forksOf('maws-engine-host')).toHaveLength(2);
    expect(supervisor.snapshot('engine-host')).toMatchObject({ state: 'restarting', pid: null, restarts: 1 });

    const next = latest('maws-engine-host');
    serve(next, (on) => on('engine.ping', async () => PING(303)));
    next.spawn(303);
    expect(supervisor.snapshot('engine-host')).toMatchObject({ state: 'ready', pid: 303, restarts: 1 });
    await expect(supervisor.dispatch('engine-host', 'engine.ping', undefined)).resolves.toEqual({ ok: true, value: PING(303) });
  });

  it('emits crashed, restarting and ready to state listeners in that order', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pty } = await startReady(1, 2);
    const states: string[] = [];
    supervisor.onState('pty-host', (s) => states.push(`${s.state}:${s.pid}:${s.revision}`));
    pty.exit(9);
    await vi.advanceTimersByTimeAsync(500);
    latest('maws-pty-host').spawn(3);
    expect(states).toEqual(['crashed:2:2', 'restarting:null:3', 'ready:3:4']);
  });

  it('leaves a host crashed after three unexpected exits within sixty seconds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine } = await startReady(10);
    engine.exit();
    await vi.advanceTimersByTimeAsync(500);
    latest('maws-engine-host').spawn(11);
    latest('maws-engine-host').exit();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(forksOf('maws-engine-host')).toHaveLength(2); // second backoff is 2 s
    await vi.advanceTimersByTimeAsync(1);
    expect(forksOf('maws-engine-host')).toHaveLength(3);
    latest('maws-engine-host').spawn(12);
    const beforeLast = supervisor.snapshot('engine-host').revision;
    latest('maws-engine-host').exit();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(forksOf('maws-engine-host')).toHaveLength(3);
    const final = supervisor.snapshot('engine-host');
    expect(final).toMatchObject({ state: 'crashed', pid: 12, restarts: 2 });
    expect(final.revision).toBeGreaterThan(beforeLast);
    await expect(supervisor.dispatch('engine-host', 'engine.ping', undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'host_unavailable' },
    });
    expect(supervisor.snapshot('pty-host')).toMatchObject({ state: 'ready' }); // the other host is untouched
  });

  it('counts only the exits of the last sixty seconds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine } = await startReady(10);
    engine.exit();
    await vi.advanceTimersByTimeAsync(500);
    latest('maws-engine-host').spawn(11);
    await vi.advanceTimersByTimeAsync(30_000);
    latest('maws-engine-host').exit();
    await vi.advanceTimersByTimeAsync(2_000);
    latest('maws-engine-host').spawn(12);
    await vi.advanceTimersByTimeAsync(40_000); // the first exit is now more than sixty seconds old
    latest('maws-engine-host').exit(); // two exits in the window: restarted, after the third step (5 s)
    await vi.advanceTimersByTimeAsync(4_999);
    expect(forksOf('maws-engine-host')).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(forksOf('maws-engine-host')).toHaveLength(4);
    expect(supervisor.snapshot('engine-host')).toMatchObject({ state: 'restarting', restarts: 3 });
  });

  it('tells the renderer every pty it knew of is gone when the pty host crashes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    void supervisor.start();
    const pty = latest('maws-pty-host');
    let next = 0;
    serve(pty, (on) => on('pty.spawn', async () => ({ ptyId: `p${++next}` as never, pid: 1000 + next })));
    pty.spawn(2);
    for (let i = 0; i < 3; i++) {
      await supervisor.dispatch('pty-host', 'pty.spawn', { appSessionId: 'a1', label: `terminal-${i}`, cwd: '/', cols: 80, rows: 24 });
    }
    fromHost(pty, { t: 'evt', name: 'pty.exit', payload: { ptyId: 'p2', exitCode: 0, signal: null } });
    await flush();
    emit.mockClear();
    pty.exit(137);
    expect(emit.mock.calls).toEqual([
      ['pty.exit', { ptyId: 'p1', exitCode: null, signal: null }],
      ['pty.exit', { ptyId: 'p3', exitCode: null, signal: null }],
    ]);
  });

  it('stop() kills both hosts, fails pending requests and never restarts', async () => {
    const { engine, pty } = await startReady();
    engine.hello!.port.listeners.length = 0; // the engine host stops answering
    const pending = supervisor.dispatch('engine-host', 'engine.ping', undefined);
    supervisor.stop();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(engine.killed && pty.killed).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(electron.forks).toHaveLength(2);
    await expect(supervisor.dispatch('pty-host', 'pty.ping', undefined)).resolves.toMatchObject({
      error: { code: 'host_unavailable' },
    });
  });

  // C11 start: the dev-only MAWS_RELAY_URL (C11 M6, ruled 2026-09-29) never reaches a packaged app's engine host.
  describe('the dev-only relay override', () => {
    afterEach(() => {
      delete process.env.MAWS_RELAY_URL;
      electron.app.isPackaged = false;
    });

    it('a packaged app drops MAWS_RELAY_URL from the environment its hosts inherit', async () => {
      process.env.MAWS_RELAY_URL = 'http://127.0.0.1:18641';
      electron.app.isPackaged = true;
      void supervisor.start();
      expect(latest('maws-engine-host').relayOverride).toBeUndefined();
      expect(process.env.MAWS_RELAY_URL).toBeUndefined();
    });

    it('a dev build passes it through', async () => {
      process.env.MAWS_RELAY_URL = 'http://127.0.0.1:18641';
      void supervisor.start();
      expect(latest('maws-engine-host').relayOverride).toBe('http://127.0.0.1:18641');
    });
  });
  // C11 end
});
