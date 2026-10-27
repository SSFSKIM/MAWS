// Test support for main's detached transport (E10): a stand-in supervisor that serves the real socket layer
// (serveSocketClients over the real host runtime) on a real Unix socket under a temp profile, with fake pids whose
// liveness and start times the test owns. The transport under test is given `processes.isAlive` and
// `processes.procStartOf`, so a fake pid is alive exactly while the test says it is.
//
// P5 O1 M6: `speaks: 'protocol-2'` stands in for a supervisor a pre-O1 app left running: it knows protocol 2's handshake
// only (any other protocol refused `protocol`, a fingerprint other than its own refused `wire`, one `exit` honoured on a
// refused connection) and closes a connection that sends a line protocol 2's strict envelope refuses (a request's
// `client`, a `clientGone`).
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostReadySchema, HostRequestV2Schema } from '@shared/ipc/host-protocol';
import { createHostRuntime, type HostEmit, type HostRegister, type HostRuntime } from '@shared/host/runtime';
import { SocketPort } from '@shared/host/socket-port';
import { serveSocketClients, type SocketClients } from '@shared/host/socket-server';
import { ClientExitSchema, ClientHelloV2Schema, HelloPreambleSchema, SOCKET_PROTOCOL, SOCKET_PROTOCOL_V2, splitLines, type ServerRefuse, type ServerWelcomeV2 } from '@shared/host/socket-protocol';
import { WIRE_CAPABILITIES, WIRE_MINOR } from '@shared/ipc/wire';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { buildIdOf, socketPathFor, SUPERVISOR_FILES, type LockFile } from '../../src/engine-host/supervisor-files';

// The fake process table: pid → start time, for the pids the test says are alive.
export class FakeProcesses {
  readonly alive = new Map<number, string>();
  private next = 70_001;
  readonly kills: [number, NodeJS.Signals][] = [];
  // What a signal does to a fake pid; by default it dies.
  onKill: (pid: number, signal: NodeJS.Signals) => void = (pid) => void this.alive.delete(pid);

  newPid(): number {
    const pid = this.next++;
    this.alive.set(pid, `start-${pid}`);
    return pid;
  }

  readonly deps = {
    isAlive: (pid: number) => this.alive.has(pid),
    procStartOf: (pid: number) => this.alive.get(pid) ?? null,
    kill: (pid: number, signal: NodeJS.Signals) => {
      if (!this.alive.has(pid)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      this.kills.push([pid, signal]);
      this.onKill(pid, signal);
    },
  };
}

export interface FakeProfile {
  root: string;
  userData: string;
  dir: string; // <userData>/supervisor
  modulePath: string; // a stand-in engine-host bundle; its bytes are the build id
  socketPath: string;
  dispose(): void;
}

// A temp profile with a short path (the socket must fit sun_path) and a bundle file to hash.
export function fakeProfile(prefix = 'maws-dt-'): FakeProfile {
  const root = join(tmpdir(), `${prefix}${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  const userData = root;
  const dir = join(userData, 'supervisor');
  const modulePath = join(root, 'engine-host.js');
  writeFileSync(modulePath, `// the engine host bundle ${root}`);
  return { root, userData, dir, modulePath, socketPath: socketPathFor(dir, userData, tmpdir()), dispose: () => rmSync(root, { recursive: true, force: true }) };
}

export interface FakeSupervisorOptions {
  pid: number;
  answer?: 'serve' | 'silent'; // silent: accepts connections and never answers a hello
  speaks?: 'protocol-2'; // P5 O1 M6: a pre-O1 supervisor (above)
  wire?: string;
  buildId?: string;
  protocol?: number;
  minor?: number; // P5 O1 M6: WIRE_MINOR unless told
  capabilities?: string[]; // P5 O1 M6: WIRE_CAPABILITIES unless told
  token?: string;
  counts?: { liveSessions: number; rows: number };
  register?: HostRegister;
  // P5 O1 M5: a runtime the test built (over its own registry) to serve in place of this fake's engine host; `register`
  // and `emit` then go unused
  runtime?: HostRuntime;
  docHighWater?: number; // P3-A M5: the document channels' reset mark
  // What `exit {when: 'now'}` does; by default the supervisor exits at once (its files removed, its pid dead).
  onExitNow?: (supervisor: FakeSupervisor) => void;
}

export class FakeSupervisor {
  readonly exits: ('now' | 'idle')[] = [];
  readonly logs: string[] = [];
  readonly connections: Socket[] = [];
  emit!: HostEmit;
  token: string;
  counts: { liveSessions: number; rows: number };
  private server: Server | null = null;
  private clients: SocketClients | null = null;

  constructor(
    private readonly profile: FakeProfile,
    private readonly processes: FakeProcesses,
    readonly options: FakeSupervisorOptions,
  ) {
    this.token = options.token ?? `token-${options.pid}`;
    this.counts = options.counts ?? { liveSessions: 0, rows: 0 };
  }

  get pid(): number {
    return this.options.pid;
  }

  // lock, token, listen: as the detached entry does (a leftover socket file is unlinked first)
  async start(): Promise<this> {
    const { dir, socketPath } = this.profile;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lock: LockFile = {
      pid: this.pid,
      procStart: this.processes.alive.get(this.pid) ?? '',
      protocol: this.options.protocol ?? (this.options.speaks === 'protocol-2' ? SOCKET_PROTOCOL_V2 : SOCKET_PROTOCOL),
      buildId: this.options.buildId ?? buildIdOf(this.profile.modulePath),
      socketPath,
      startedAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, SUPERVISOR_FILES.lock), JSON.stringify(lock));
    writeFileSync(join(dir, SUPERVISOR_FILES.token), this.token);
    try {
      unlinkSync(socketPath);
    } catch {
      // none
    }
    const server = createServer();
    server.on('connection', (socket) => {
      this.connections.push(socket);
      socket.on('error', () => {});
    });
    const runtime = () =>
      this.options.runtime ??
      createHostRuntime((on, emit, client) => {
        this.emit = emit;
        on('engine.ping', async () => ({ pid: this.pid, uptimeMs: 1, hostVersion: 'fake' }));
        this.options.register?.(on, emit, client);
      });
    if (this.options.speaks === 'protocol-2') this.serveProtocol2(server, runtime(), lock.startedAt);
    else if ((this.options.answer ?? 'serve') === 'serve') {
      this.clients = serveSocketClients(server, {
        runtime: runtime(),
        identity: () => ({
          protocol: this.options.protocol ?? SOCKET_PROTOCOL,
          minor: this.options.minor ?? WIRE_MINOR,
          buildId: this.options.buildId ?? buildIdOf(this.profile.modulePath),
          capabilities: this.options.capabilities ?? WIRE_CAPABILITIES,
          wire: this.options.wire ?? wireFingerprint(),
          pid: this.pid,
          startedAt: lock.startedAt,
        }),
        counts: () => this.counts,
        token: () => this.token,
        onExit: (when) => {
          this.exits.push(when);
          if (when === 'now') (this.options.onExitNow ?? ((s) => void s.die()))(this);
        },
        log: (line) => void this.logs.push(line),
        docHighWater: this.options.docHighWater, // P3-A M5
      });
    }
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });
    this.server = server;
    return this;
  }

  connected(): boolean {
    return this.clients ? this.clients.connected() : this.v2Client !== null;
  }

  // P5 O1 M6: what the connected client's hello said of it (a protocol-2 supervisor keeps nothing)
  peer() {
    return this.clients?.peer() ?? null;
  }

  // The client's connection closes while this supervisor lives on (a backpressure close, a socket error).
  dropClient(): void {
    this.clients?.closeClient();
    this.v2Client?.close();
  }

  // P5 O1 M6 start: protocol 2's server side, as a pre-O1 supervisor ran it (no document channels).
  private v2Client: SocketPort | null = null;

  private serveProtocol2(server: Server, runtime: HostRuntime, startedAt: string): void {
    const buildId = this.options.buildId ?? buildIdOf(this.profile.modulePath);
    const wire = this.options.wire ?? wireFingerprint();
    const refusal = (reason: ServerRefuse['reason']): ServerRefuse => ({ t: 'refuse', reason, protocol: SOCKET_PROTOCOL_V2, buildId, wire, liveSessions: this.counts.liveSessions });
    const refuse = (socket: Socket, reason: ServerRefuse['reason']) => {
      if (socket.writable) socket.write(`${JSON.stringify(refusal(reason))}\n`);
    };
    const exit = (when: 'now' | 'idle') => {
      this.exits.push(when);
      if (when === 'now') (this.options.onExitNow ?? ((s) => void s.die()))(this);
    };
    server.on('connection', (socket) => {
      let phase: 'hello' | 'refused' | 'welcomed' = 'hello';
      const splitter = splitLines(
        (line) => {
          const data = JSON.parse(line) as unknown;
          if (phase === 'refused') {
            const asked = ClientExitSchema.safeParse(data);
            if (asked.success) exit(asked.data.when);
            else socket.destroy();
            return 'stop';
          }
          const preamble = HelloPreambleSchema.safeParse(data);
          if (!preamble.success || preamble.data.token !== this.token) {
            refuse(socket, 'token');
            socket.end();
            return 'stop';
          }
          if (preamble.data.protocol !== SOCKET_PROTOCOL_V2) {
            this.logs.push(`refused protocol ${preamble.data.protocol} (this supervisor speaks ${SOCKET_PROTOCOL_V2})`);
            refuse(socket, 'protocol');
            phase = 'refused';
            return;
          }
          const hello = ClientHelloV2Schema.safeParse(data);
          if (!hello.success) {
            socket.destroy();
            return 'stop';
          }
          if (hello.data.wire !== wire) {
            this.logs.push(`refused wire ${hello.data.wire}`);
            refuse(socket, 'wire');
            phase = 'refused';
            return;
          }
          phase = 'welcomed';
          return 'stop';
        },
        () => socket.destroy(),
      );
      const onData = (chunk: Buffer) => {
        splitter.push(chunk);
        if (phase !== 'welcomed') return;
        socket.off('data', onData);
        const replaced = this.v2Client;
        if (replaced) {
          replaced.postMessage(refusal('replaced'));
          replaced.close();
        }
        const line: ServerWelcomeV2 = { t: 'welcome', protocol: SOCKET_PROTOCOL_V2, buildId, wire, pid: this.pid, startedAt, ...this.counts };
        socket.write(`${JSON.stringify(line)}\n`);
        const port = new SocketPort(socket, splitter.rest(), { log: (logged) => void this.logs.push(logged) });
        this.v2Client = port;
        port.onClose(() => {
          if (this.v2Client !== port) return;
          this.v2Client = null;
          runtime.detach();
        });
        runtime.serve({
          postMessage: (message: unknown) => port.postMessage(message),
          start: () => port.start(),
          on: (_event: 'message', listener: (event: { data: unknown }) => void) =>
            port.on('message', (event) => {
              const asked = ClientExitSchema.safeParse(event.data);
              if (asked.success) return exit(asked.data.when);
              // protocol 2's envelope from main, in the forms the manifest freezes: no request `client`, no `clientGone`
              if (HostRequestV2Schema.safeParse(event.data).success || HostReadySchema.safeParse(event.data).success) return listener(event);
              this.logs.push(`closed the client: a line protocol 2 refuses: ${JSON.stringify(event.data)}`);
              port.close();
            }),
        });
      };
      socket.on('data', onData);
    });
  }
  // P5 O1 M6 end

  // The process ends: the server closes, every connection drops, the pid is dead. A clean exit removes the lock and
  // the token as the exit order does; a crash (`keepLock`) leaves them for the successor's staleness check.
  async die({ keepLock = false }: { keepLock?: boolean } = {}): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const socket of this.connections) socket.destroy();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    this.processes.alive.delete(this.pid);
    if (!keepLock) {
      for (const name of [SUPERVISOR_FILES.lock, SUPERVISOR_FILES.token]) {
        try {
          unlinkSync(join(this.profile.dir, name));
        } catch {
          // already gone
        }
      }
    }
  }

  readLockFile(): LockFile {
    return JSON.parse(readFileSync(join(this.profile.dir, SUPERVISOR_FILES.lock), 'utf8')) as LockFile;
  }
}
