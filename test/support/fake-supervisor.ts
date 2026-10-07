// Test support for main's detached transport (E10): a stand-in supervisor that serves the real socket layer
// (serveSocketClients over the real host runtime) on a real Unix socket under a temp profile, with fake pids whose
// liveness and start times the test owns. The transport under test is given `processes.isAlive` and
// `processes.procStartOf`, so a fake pid is alive exactly while the test says it is.
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostRuntime, type HostEmit, type HostRegister } from '@shared/host/runtime';
import { serveSocketClients, type SocketClients } from '@shared/host/socket-server';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
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
  wire?: string;
  buildId?: string;
  protocol?: number;
  token?: string;
  counts?: { liveSessions: number; rows: number };
  register?: HostRegister;
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
      protocol: this.options.protocol ?? SOCKET_PROTOCOL,
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
    if ((this.options.answer ?? 'serve') === 'serve') {
      this.clients = serveSocketClients(server, {
        runtime: createHostRuntime((on, emit, client) => {
          this.emit = emit;
          on('engine.ping', async () => ({ pid: this.pid, uptimeMs: 1, hostVersion: 'fake' }));
          this.options.register?.(on, emit, client);
        }),
        identity: () => ({
          protocol: this.options.protocol ?? SOCKET_PROTOCOL,
          buildId: this.options.buildId ?? buildIdOf(this.profile.modulePath),
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
    return this.clients?.connected() ?? false;
  }

  // The client's connection closes while this supervisor lives on (a backpressure close, a socket error).
  dropClient(): void {
    this.clients?.closeClient();
  }

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
