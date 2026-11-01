// Test support for `mawsd` (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): the daemon itself
// (src/mawsd/daemon.ts, in this process) over a temp profile, with its upstream hosts stood in for by the real socket
// layer and runtime on real Unix sockets (fake-supervisor.ts), spawned through a fake spawn with fake pids whose liveness
// the test owns. Its clients are either a raw app (`RawApp`: the hello, then C1's envelope through the real SocketPort)
// or main's own host supervisor over the relayed detached transport (`appHosts`).
import type { SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi, type Mock } from 'vitest';
import * as z from 'zod';
import { daemonHostFiles, daemonPaths, type DaemonPaths, type DaemonSocket } from '@shared/daemon/files';
import { createHostSupervisor, type HostSupervisor, type HostSupervisorOptions } from '@shared/host/host-supervisor';
import type { ClientRef } from '@shared/ipc/client';
import type { DocPortEnd, HostEmit, HostOn, HostRuntime } from '@shared/host/runtime';
import { createHostRuntime } from '@shared/host/runtime';
import { SocketPort } from '@shared/host/socket-port';
import { appIdentity } from '@shared/host/identity';
import { PTY_FRAMES_CAPABILITY, SOCKET_PROTOCOL, splitLines } from '@shared/host/socket-protocol';
import type { HostDoc } from '@shared/ipc/host-protocol';
import type { WireRegistry } from '@shared/ipc/registry';
import { WIRE_MINOR } from '@shared/ipc/wire';
import { startDaemon, type DaemonOptions, type RunningDaemon } from '../../src/mawsd/daemon';
import { registerAttachment } from '../../src/engine-host/attachment';
import { procStartOf } from '../../src/engine-host/supervisor-files';
import { ptyHostSocketPath } from '../../src/pty-host/files';
import { fakeProfile, FakeProcesses, FakeSupervisor, type FakeProfile, type FakeSupervisorOptions } from './fake-supervisor';

// P5 O3-D M5b (D47): a raw app's hello lists what an app listed before the cutover (no `machine.spine`): the existing
// daemon tests' apps, which a daemon with `claimSpine` off serves as before; a test of the cutover names its own list
export const APP_BEFORE_SPINE_CAPABILITIES = [PTY_FRAMES_CAPABILITY] as const;

export const TIMING = { connectTimeoutMs: 200, helloTimeoutMs: 300, startTimeoutMs: 2_000, pidPollMs: 20, waitRetryMs: 80, killGraceMs: 60 };
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// What the stand-in engine host serves: every command it is sent, read as received (z.unknown), so a test sees the
// relay's inputs exactly; one event, `probe.event`, whose payload is anything (keys no registry names included).
const ANY = { input: z.unknown(), output: z.unknown(), owner: 'engine-host' as const };
export const ENGINE_COMMANDS = ['engine.ping', 'host.interest', 'host.stopAll', 'host.configure', 'host.exitWhenIdle', 'host.supervisorStatus', 'host.attachment' /* P5 O3-D M3 */, 'probe.newer', 'host.op', 'session.rewind' /* P5 O3-D M5a (D47): what reaches the host raw */, 'artifacts.content' /* P5 O5 M2: the artifact endpoint's lookup */, 'maws.artifact.captured', 'maws.artifact.exported' /* P5 O5 M4: the render seam's answers */, 'artifacts.get' /* P5 O5 M4: a render host's snapshot read */] as const;
const ENGINE_REGISTRY = {
  commands: Object.fromEntries(ENGINE_COMMANDS.map((name) => [name, ANY])),
  events: { 'probe.event': z.unknown(), 'maws.artifact.capture': z.unknown(), 'maws.artifact.export': z.unknown() /* P5 O5 M4: the bridges' requests */, 'session.status': z.unknown() /* P5 O5 M5: the cua socket's peer check reads it raw */ },
  hostEvents: ['probe.event', 'maws.artifact.capture', 'maws.artifact.export', 'session.status'],
  ptyHostEvents: [],
  machineEvents: [],
  mainOnly: new Set<string>(),
} as const satisfies WireRegistry;

const PTY_ANY = { input: z.unknown(), output: z.unknown(), owner: 'pty-host' as const };
export const PTY_COMMANDS = ['pty.ping', 'pty.list', 'pty.ack', 'pty.attach', 'pty.recaptureEnv', 'pty.checkpoint', 'pty.op' /* P5 O7 M3: the seam's inner-name guard */] as const;
const PTY_REGISTRY = {
  commands: Object.fromEntries(PTY_COMMANDS.map((name) => [name, PTY_ANY])),
  events: { 'pty.exit': z.unknown() },
  hostEvents: [],
  ptyHostEvents: ['pty.exit'],
  machineEvents: [],
  mainOnly: new Set<string>(),
} as const satisfies WireRegistry;

export interface StandInOptions extends Partial<Omit<FakeSupervisorOptions, 'runtime' | 'register'>> {
  answers?: Record<string, (input: unknown) => unknown>; // a command's answer (default: null)
}

// A stand-in host: records each request, answers from `answers`, and (the engine host's) keeps an event emitted with no
// ready client for the next client's connect burst, as SessionStream's undelivered tail does.
export class StandIn {
  readonly calls: { name: string; input: unknown }[] = [];
  readonly clients: ClientRef[] = []; // P5 O7 M2: each request's asker, as the runtime minted it, in order
  // P5 O3-D M3: the engine host's presence as attachment.ts keeps it: its gone hooks run, its shell recaptures counted
  appGone = 0;
  shellRecaptured = 0;
  readonly pending: unknown[] = [];
  readonly docs: { message: HostDoc; end: DocPortEnd; frames: Uint8Array[]; closed: boolean }[] = [];
  supervisor!: FakeSupervisor;
  private hostEmit!: HostEmit<WireRegistry>;

  constructor(
    readonly kind: 'engine-host' | 'pty-host',
    answers: Record<string, (input: unknown) => unknown> = {},
  ) {
    this.answers = kind === 'pty-host' ? { 'pty.list': () => ({ ptys: [] }), ...answers } : answers;
  }

  private readonly answers: Record<string, (input: unknown) => unknown>;

  runtime(): HostRuntime {
    const names = this.kind === 'engine-host' ? ENGINE_COMMANDS : PTY_COMMANDS;
    return createHostRuntime<WireRegistry>(
      (on, emit, client) => {
        this.hostEmit = emit;
        for (const name of names.filter((n) => n !== 'host.attachment'))
          on(name, async (input, ctx) => {
            this.calls.push({ name, input });
            this.clients.push(ctx.client);
            return (this.answers[name]?.(input) ?? null) as never;
          });
        if (this.kind !== 'engine-host') return;
        // P5 O3-D M3: host.attachment served as the engine host serves it (recorded, and an `answers` hook run first)
        const recorded = ((name: string, handler: (input: unknown, ctx: never) => Promise<unknown>) =>
          on(name as never, async (input, ctx) => {
            this.calls.push({ name, input });
            this.answers[name]?.(input);
            return handler(input, ctx as never) as never;
          })) as unknown as HostOn;
        registerAttachment(recorded, client, () => void this.shellRecaptured++);
        client.presence.onGone(() => void this.appGone++);
        client.onConnect(() => {
          for (const payload of this.pending.splice(0)) this.send(payload);
        });
        // A document channel: every frame it receives is recorded and echoed back with one byte (0xff) appended.
        client.onDocPort((message, end) => {
          const doc = { message, end, frames: [] as Uint8Array[], closed: false };
          this.docs.push(doc);
          end.on('message', ({ data }) => {
            const frame = data as Uint8Array;
            doc.frames.push(frame);
            end.postMessage(Uint8Array.of(...frame, 0xff));
          });
          end.on('close', () => void (doc.closed = true));
          end.start();
        });
      },
      { registry: this.kind === 'engine-host' ? ENGINE_REGISTRY : PTY_REGISTRY },
    );
  }

  // An event to the client: written if one is ready, else kept for the next connect burst (the engine host's).
  send(payload: unknown): boolean {
    if (this.hostEmit('probe.event', payload)) return true;
    this.pending.push(payload);
    return false;
  }

  emitRaw(name: string, payload: unknown): boolean {
    return this.hostEmit(name, payload);
  }

  get pid(): number {
    return this.supervisor.pid;
  }

  named(name: string): unknown[] {
    return this.calls.filter((call) => call.name === name).map((call) => call.input);
  }
}

class FakeChild extends EventEmitter {
  unref(): void {}
  constructor(
    readonly pid: number,
    readonly command: string,
    readonly args: string[],
    readonly options: SpawnOptions,
  ) {
    super();
  }
}

// A host a test brings up itself (the pty host's real handlers, over node-pty) instead of a StandIn.
export type HostBringUp = (pid: number) => Promise<FakeSupervisor>;

export class MawsdScene {
  readonly profile: FakeProfile; // the engine host's (<root>/supervisor) and the profile's root
  readonly ptyProfile: FakeProfile; // the pty host's (<root>/mawsd/pty-host)
  readonly paths: DaemonPaths;
  readonly self: string; // a stand-in mawsd bundle (its build id)
  readonly processes = new FakeProcesses();
  readonly logs: string[] = [];
  readonly collect: Mock<() => void> = vi.fn(); // the idle collection's stand-in (P5 Decision Log 124): a scene runs no real one
  readonly exits: number[] = [];
  readonly commands: string[][] = [];
  readonly engines: StandIn[] = [];
  readonly ptys: StandIn[] = [];
  readonly supervisors: FakeSupervisor[] = [];
  readonly apps: RawApp[] = [];
  readonly appSupervisors: HostSupervisor[] = [];
  readonly daemons: RunningDaemon[] = [];
  // What a spawn of each host starts (by default a StandIn served at once); null starts nothing
  engineSpawn: StandInOptions | null = {};
  ptySpawn: StandInOptions | HostBringUp | null = {};
  readonly spawn = vi.fn((command: string, args: string[], options: SpawnOptions) => {
    const child = new FakeChild(this.processes.newPid(), command, args, options);
    const pty = args.includes(this.ptyProfile.modulePath);
    queueMicrotask(() => {
      const plan = pty ? this.ptySpawn : this.engineSpawn;
      if (plan === null) return;
      if (typeof plan === 'function') void plan(child.pid).then((supervisor) => void this.supervisors.push(supervisor));
      else void (pty ? this.pty({ ...plan, pid: child.pid }) : this.engine({ ...plan, pid: child.pid }));
    });
    return child;
  });

  constructor(prefix = 'maws-md-') {
    this.profile = fakeProfile(prefix);
    const ptyDir = join(this.profile.root, 'mawsd', 'pty-host');
    const ptyModule = join(this.profile.root, 'pty-host.js');
    writeFileSync(ptyModule, `// the pty host bundle ${this.profile.root}`);
    this.ptyProfile = { ...this.profile, dir: ptyDir, modulePath: ptyModule, socketPath: ptyHostSocketPath(ptyDir) };
    this.self = join(this.profile.root, 'mawsd.js');
    writeFileSync(this.self, `// the mawsd bundle ${this.profile.root}`);
    this.paths = daemonPaths(this.profile.root);
  }

  get root(): string {
    return this.profile.root;
  }

  async engine(options: StandInOptions = {}): Promise<StandIn> {
    const host = new StandIn('engine-host', options.answers);
    this.engines.push(host);
    host.supervisor = await this.serve(this.profile, { ...options, runtime: host.runtime() });
    return host;
  }

  async pty(options: StandInOptions = {}): Promise<StandIn> {
    const host = new StandIn('pty-host', options.answers);
    this.ptys.push(host);
    mkdirSync(this.ptyProfile.dir, { recursive: true, mode: 0o700 });
    host.supervisor = await this.serve(this.ptyProfile, { ...options, runtime: host.runtime() });
    return host;
  }

  // A host served by the real socket layer (over `runtime` or `register`), its pid alive in the fake table.
  async serve(at: FakeProfile, options: Partial<FakeSupervisorOptions>): Promise<FakeSupervisor> {
    const pid = options.pid ?? this.processes.newPid();
    if (!this.processes.alive.has(pid)) this.processes.alive.set(pid, `start-${pid}`);
    const supervisor = new FakeSupervisor(at, this.processes, { ...options, pid });
    this.supervisors.push(supervisor);
    return supervisor.start();
  }

  lastEngine(): StandIn {
    const engine = this.engines.at(-1);
    if (!engine) throw new Error('no engine host was started');
    return engine;
  }

  options(extra: Partial<DaemonOptions> = {}): DaemonOptions {
    return {
      kind: 'private',
      dir: this.paths.dir,
      profileDir: this.root,
      modules: { self: this.self, engineHost: this.profile.modulePath, ptyHost: this.ptyProfile.modulePath },
      build: { version: '0.0.0-test', commit: 'test', builtAt: '2026-10-27T00:00:00.000Z' },
      env: { MAWS_USER_DATA: this.root },
      exit: (code) => void this.exits.push(code),
      openLog: () => (line) => void this.logs.push(line),
      refuse: (line) => void this.logs.push(`refused: ${line}`),
      endpoint: null,
      detached: { spawn: this.spawn as never, ...this.processes.deps, timing: TIMING },
      runCommand: (command, args) => {
        this.commands.push([command, ...args]);
        return { status: 0, stdout: '' };
      },
      platform: 'linux',
      tmp: tmpdir(),
      execPath: '/opt/maws/node',
      restartBackoffMs: [30, 60, 90],
      helloHoldMs: 2_000,
      collect: this.collect,
      ...extra,
    };
  }

  async start(extra: Partial<DaemonOptions> = {}): Promise<RunningDaemon> {
    const daemon = await startDaemon(this.options(extra));
    if (!daemon) throw new Error(`mawsd did not start (exits ${JSON.stringify(this.exits)}):\n${this.logs.join('\n')}`);
    this.daemons.push(daemon);
    return daemon;
  }

  token(): string {
    return readFileSync(join(this.paths.dir, 'mawsd.token'), 'utf8').trim();
  }

  // A raw app on one of mawsd's sockets
  async app(socket: DaemonSocket = 'engine-host', options: RawHelloOptions = {}): Promise<RawApp> {
    const app = await RawApp.connect(this.paths.sockets[socket], options.token ?? this.token(), options);
    this.apps.push(app);
    return app;
  }

  // Main's own host supervisor reaching mawsd's engine-host.sock over the relayed detached transport (M7's daemon shape)
  appHosts(options: Partial<HostSupervisorOptions> = {}): HostSupervisor {
    const real = (pid: number) => pid === process.pid;
    const hosts = createHostSupervisor({
      hosts: {
        'engine-host': {
          modulePath: this.profile.modulePath,
          serviceName: 'maws-supervisor',
          transport: 'detached',
          detached: { files: daemonHostFiles(this.paths, 'engine-host'), start: { kind: 'none' }, relayed: true },
        },
      } as never,
      emit: () => true,
      restartBackoffMs: [30, 60, 90],
      userData: () => this.root,
      packaged: () => false,
      detached: {
        env: () => ({}),
        isAlive: (pid) => real(pid) || this.processes.deps.isAlive(pid),
        procStartOf: (pid) => (real(pid) ? procStartOf(pid) : this.processes.deps.procStartOf(pid)),
        kill: (pid, signal) => {
          if (real(pid)) throw new Error('the test process is never signalled');
          this.processes.deps.kill(pid, signal);
        },
        timing: { ...TIMING, startTimeoutMs: 6_000 },
        log: (line) => void this.logs.push(`[app] ${line}`),
        identity: appIdentity(this.profile.modulePath, {}, 'detached', APP_BEFORE_SPINE_CAPABILITIES), // D47: an app of before the cutover
      },
      ...options,
    });
    this.appSupervisors.push(hosts);
    return hosts;
  }

  async dispose(): Promise<void> {
    for (const app of this.apps) app.destroy();
    for (const hosts of this.appSupervisors) hosts.stop();
    await Promise.all(this.daemons.map((daemon) => daemon.stop('test over')));
    for (const supervisor of this.supervisors) await supervisor.die();
    rmSync(this.root, { recursive: true, force: true });
  }
}

export interface RawHelloOptions {
  token?: string;
  capabilities?: string[];
  appPid?: number; // P5 O3-D M5: the app's pid its hello names (this process's unless a test names another)
}

// An app on a relay socket, raw: its hello, then (once welcomed) C1's envelope and the document frames through the real
// SocketPort, every message it receives kept in order.
export class RawApp {
  first: Record<string, unknown> | null = null; // the welcome or the refusal, or null when closed unanswered
  port: SocketPort | null = null;
  readonly messages: Record<string, unknown>[] = [];
  readonly frames: { channel: number; bytes: Uint8Array }[] = [];
  closed = false;
  ended = false; // the server's FIN arrived
  private next = 0;

  private constructor(readonly socket: Socket) {}

  static connect(path: string, token: string, options: RawHelloOptions = {}): Promise<RawApp> {
    return new Promise((resolve) => {
      const socket = createConnection(path);
      const app = new RawApp(socket);
      const capabilities = options.capabilities ?? [...APP_BEFORE_SPINE_CAPABILITIES]; // P5 O3-D: an app's own list, not the wire's union
      socket.on('error', () => {});
      socket.on('end', () => void (app.ended = true));
      socket.on('close', () => {
        app.closed = true;
        resolve(app);
      });
      const splitter = splitLines(
        (line) => {
          app.first = JSON.parse(line) as Record<string, unknown>;
          return 'stop';
        },
        () => socket.destroy(),
      );
      const onData = (chunk: Buffer) => {
        splitter.push(chunk);
        if (!app.first) return;
        socket.off('data', onData);
        if (app.first.t === 'welcome') {
          const peer = (app.first.capabilities as string[] | undefined) ?? [];
          const port = new SocketPort(socket, splitter.rest(), { log: () => {}, ptyFrames: capabilities.includes(PTY_FRAMES_CAPABILITY) && peer.includes(PTY_FRAMES_CAPABILITY) });
          app.port = port;
          port.on('message', ({ data }) => void app.messages.push(data as Record<string, unknown>));
          port.onDoc((channel, bytes) => void app.frames.push({ channel, bytes }));
          port.start();
        }
        resolve(app);
      };
      socket.on('data', onData);
      socket.on('connect', () => {
        socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build: 'raw-app', capabilities, appPid: options.appPid ?? process.pid })}\n`);
      });
    });
  }

  welcomed(): boolean {
    return this.first?.t === 'welcome';
  }

  post(message: unknown): void {
    if (!this.port) throw new Error(`not welcomed: ${JSON.stringify(this.first)}`);
    this.port.postMessage(message);
  }

  async request(name: string, input?: unknown, timeout = 5_000): Promise<Record<string, unknown>> {
    const id = `raw-${++this.next}`;
    this.post({ t: 'req', id, name, input });
    await vi.waitFor(() => {
      if (!this.messages.some((message) => message.t === 'res' && message.id === id)) throw new Error(`no answer to ${name}`);
    }, { timeout, interval: 5 });
    return this.messages.find((message) => message.t === 'res' && message.id === id)!;
  }

  ready(): void {
    this.post({ t: 'ready' });
  }

  events(name = 'probe.event'): unknown[] {
    return this.messages.filter((message) => message.t === 'evt' && message.name === name).map((message) => message.payload);
  }

  // `exit` on a refused connection (a raw line) or a welcomed one (through the port)
  exit(when: 'now' | 'idle'): void {
    const line = { t: 'exit', when };
    if (this.port) this.port.postMessage(line);
    else this.socket.write(`${JSON.stringify(line)}\n`);
  }

  // E11's draining close (main's quit), or a plain one
  leave(drain = true): void {
    if (this.port) this.port.close({ drain });
    else this.socket.end();
  }

  destroy(): void {
    this.socket.destroy();
  }
}

// `what` names the awaited condition; a function is read at the timeout, so a message can carry the state it timed out in
export const until = (check: () => boolean, timeout = 5_000, what: string | (() => string) = 'the condition') =>
  vi.waitFor(
    () => {
      if (!check()) throw new Error(`timed out waiting for ${typeof what === 'function' ? what() : what}`);
    },
    { timeout, interval: 5 },
  );
