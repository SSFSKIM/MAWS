// A host process in socket mode (P5 O2 M4; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): what the engine host's
// supervisor (E10, src/engine-host/detached.ts) and the pty host's socket mode (src/pty-host/detached.ts) share, factored
// out of the first. The process takes its directory's lock, writes a fresh token, listens on its Unix socket and serves
// one client at a time through C1's runtime, so every handler runs exactly as in a utility process. Each host keeps its
// own life on top: the engine host its orphan sweep and Supervision, the pty host nothing more.
//
// The start: (a) the directory, created 0700 when missing and checked (a symlink, another owner or a mode wider than
// 0700 stops the start, the error naming the path; @shared/host/private-listen); (b) the lock over the host's names
// (`takeLock`; held → exit START_EXIT_HELD); (c) the token; (d) the socket path cleared (nothing, or this uid's stale
// socket) and listened on, 0600; then `listening`, synchronously. A SIGTERM during the start aborts it at the next step
// (START_EXIT_ABORTED), removing the lock it took.
//
// One exit order for every reason: (1) the server stops accepting; (2) the host's `shutdown` (bounded); (3) on a clean
// exit, the host's own `clean` step, then the socket file, its tmpdir fallback directory when empty, and the lock are
// removed if the lock still names this process (a successor that replaced a stale lock keeps its files); (4) the client
// is closed; (5) exit. A fatal error exits 1 and skips (3), so the successor's staleness check finds the lock.
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:net';
import { dirname, join } from 'node:path';
import { format } from 'node:util';
import { buildIdOf, isAlive, procStartOf, readLock, START_EXIT_HELD, takeLock, type LockNames } from '../../engine-host/supervisor-files';
import { wireFingerprint } from '../ipc/wire-fingerprint';
import { WIRE_MINOR } from '../ipc/wire';
import { clearSocketPath, makePrivateDirectory } from './private-listen';
import { createHostRuntime, type HostRegister } from './runtime';
import { SOCKET_PROTOCOL } from './socket-protocol';
import { serveSocketClients } from './socket-server';

// The exit codes of a start: START_EXIT_HELD (3) when another live process holds the lock, START_EXIT_ABORTED when a
// SIGTERM aborted it (128 + SIGTERM; its lock, if it took one, is already removed); 1 is fatal.
export { START_EXIT_HELD };
export const START_EXIT_ABORTED = 143;
const SHUTDOWN_BOUND_MS = 10_000; // past this the exit order goes on without the shutdown's answer

// The names inside the host's directory: its lock and break file, and its token.
export interface SocketHostFiles extends LockNames {
  token: string;
}

// The process as the start sees it, so a test runs a host in its own process.
export interface HostProcess {
  exit(code: number): void;
  aborted?(): boolean; // a SIGTERM arrived while the start was under way
}

// Who holds the lock, as the lock recorded it.
export interface LockOwner {
  pid: number;
  procStart: string;
}

export interface SocketHostOptions {
  kind: string; // how the log names this host: `supervisor`, `pty host`
  hostVersion: string;
  dir: string;
  files: SocketHostFiles;
  socketPath: string; // in `dir`, or its tmpdir fallback (socketPathFor)
  modulePath: string; // this bundle's entry file, hashed into the build id
  register: HostRegister;
  badToken: 'refuse' | 'close'; // what a wrong token gets (socket-server.ts)
  capabilities: readonly string[]; // P5 O3-D: what the welcome lists, this host's own (PEER_CAPABILITIES)
  counts(): { liveSessions: number; rows: number }; // the welcome's and the refusal's
  shutdown(): Promise<unknown>; // exit order step (2)
  clean?(owner: LockOwner): void; // step (3), a clean exit's, before the files go
  exitWhenIdle(): void; // a client's `exit {when: 'idle'}`
  onClient?(connected: boolean): void; // a client was welcomed, or the client left
  listening?(host: SocketHost): void; // serving, synchronously after the listen and before anything can be asked
  log(line: string): void;
}

export interface SocketHost {
  socketPath: string;
  buildId: string;
  startedAt: string;
  owner: LockOwner;
  stopping(): boolean; // the exit order has begun
  stop(reason: string, code?: 0 | 1): Promise<void>; // the exit order; a second call joins the first
}

// The process around a host's start: console into the log, an uncaught exception fatal, a stray rejection logged,
// SIGTERM an exit (or, during the start, an abort at its next step), and a SIGUSR1 listener of its own.
export function runSocketHost(log: (line: string) => void, start: (proc: HostProcess) => Promise<Pick<SocketHost, 'stop'> | null>): void {
  routeConsole(log);
  // Socket peer authentication (cua spec 2026-10-09-maws-socket-peer-auth-design.md, Decision Log 2026-10-10): a host is
  // the app binary run as Node, so without a listener a same-user SIGUSR1 opens a Node inspector whose code drives every
  // session's engine or every terminal, a route around the socket's checks. A listener of its own keeps Node from it.
  process.on('SIGUSR1', () => {});
  const proc: HostProcess = { exit: (code) => process.exit(code) };
  let host: Pick<SocketHost, 'stop'> | null = null;
  const fatal = (error: unknown) => {
    log(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    if (host) void host.stop('fatal', 1);
    else proc.exit(1);
  };
  process.on('uncaughtException', fatal);
  // A stray rejection is logged, not fatal: a host holding sessions or terminals outlives a bug in one of them.
  process.on('unhandledRejection', (reason) => log(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`));
  let abortRequested = false;
  proc.aborted = () => abortRequested;
  process.on('SIGTERM', () => {
    if (host) void host.stop('signal');
    else abortRequested = true;
  });
  start(proc).then((started) => {
    host = started;
    if (started && abortRequested) void started.stop('signal'); // the signal landed between listen and this line
  }, fatal);
}

// lock → token → listen → serve; null when it exited instead (the lock held, a signal, or a socket it could not make).
export async function startSocketHost(opts: SocketHostOptions, proc: HostProcess): Promise<SocketHost | null> {
  const { dir, files, socketPath, log, kind } = opts;
  const pid = process.pid;
  makePrivateDirectory(dir);
  const buildId = buildIdOf(opts.modulePath);
  log(`${kind} ${opts.hostVersion} pid ${pid} build ${buildId} starting in ${dir}`);

  const lockDeps = { fs, isAlive, procStartOf, now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };
  if ((await takeLock(dir, { protocol: SOCKET_PROTOCOL, buildId, socketPath }, lockDeps, files)) === 'held') {
    log(`another ${kind} (pid ${readLock(dir, fs, files.lock)?.pid ?? 'unknown'}) holds the lock; exiting ${START_EXIT_HELD}`);
    proc.exit(START_EXIT_HELD);
    return null;
  }
  // The owner and start time as the lock recorded them, so the exit order's ownership check compares like with like
  // even if a later `ps` of this process fails.
  const written = readLock(dir, fs, files.lock);
  const owner: LockOwner = { pid, procStart: written?.pid === pid ? written.procStart : '' };
  const startedAt = written?.startedAt ?? new Date().toISOString();
  const lockNamesMe = (): boolean => {
    const lock = readLock(dir, fs, files.lock);
    return lock !== null && lock.pid === owner.pid && lock.procStart === owner.procStart;
  };
  const abortStart = (stage: string): null => {
    log(`start aborted by a signal ${stage}; exiting ${START_EXIT_ABORTED}`);
    if (lockNamesMe()) {
      removeFallbackDirectory(socketPath, dir);
      unlinkQuietly(join(dir, files.lock));
    }
    proc.exit(START_EXIT_ABORTED);
    return null;
  };
  if (proc.aborted?.()) return abortStart('after taking the lock');
  const token = writeToken(join(dir, files.token));
  if (dirname(socketPath) !== dir) makePrivateDirectory(dirname(socketPath));

  const runtime = createHostRuntime(opts.register);
  const server = createServer();
  let stopping: Promise<void> | null = null;

  const clients = serveSocketClients(server, {
    runtime,
    badToken: opts.badToken,
    identity: () => ({ protocol: SOCKET_PROTOCOL, minor: WIRE_MINOR, buildId, capabilities: opts.capabilities, wire: wireFingerprint(), pid, startedAt }), // P5 O1 M6: the major, minor and capabilities (OX1)
    counts: () => opts.counts(),
    token: () => token,
    onExit: (when) => {
      if (when === 'now') void stop('exit');
      else opts.exitWhenIdle();
    },
    onClient: opts.onClient,
    log,
  });

  function stop(reason: string, code: 0 | 1 = 0): Promise<void> {
    stopping ??= (async () => {
      log(`exiting (${reason})`);
      server.close(); // (1) no new client; the callback would wait for the client, which (4) closes
      try {
        await Promise.race([opts.shutdown(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_BOUND_MS).unref())]); // (2)
      } catch (error) {
        log(`the exit order's shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (code === 0) {
        opts.clean?.(owner); // (3)
        if (lockNamesMe()) {
          unlinkQuietly(socketPath); // usually gone already: Node unlinks a listening path when its server closes
          removeFallbackDirectory(socketPath, dir); // before the lock goes, so no successor can be using it yet
          unlinkQuietly(join(dir, files.lock));
        }
      }
      clients.closeClient(); // (4)
      proc.exit(code); // (5)
    })();
    return stopping;
  }

  try {
    // a socket file left by a dead host (no live one can own it, since we hold the lock) is removed; P5 O2 M3: anything
    // else at the path (a symlink, a file, another uid's socket) is refused and left in place
    clearSocketPath(socketPath);
    await listen(server, socketPath);
  } catch (error) {
    log(`cannot listen on ${socketPath}: ${error instanceof Error ? error.message : String(error)}`);
    await stop('fatal', 1);
    return null;
  }
  server.on('error', (error) => log(`server error: ${error.message}`)); // an accept failure must not become fatal
  if (proc.aborted?.()) {
    server.close(); // unlinks the socket file
    return abortStart('while it started listening');
  }
  fs.chmodSync(socketPath, 0o600);
  log(`listening on ${socketPath}`);
  const host: SocketHost = { socketPath, buildId, startedAt, owner, stopping: () => stopping !== null, stop };
  opts.listening?.(host);
  return host;
}

// 32 random bytes as hex, written through a temporary file so a reader never sees half a token (P5 O2 M5: `mawsd`'s too).
export function writeToken(path: string): string {
  const token = randomBytes(32).toString('hex');
  const temporary = `${path}.${process.pid}`;
  fs.writeFileSync(temporary, token, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, path);
  return token;
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

// The tmpdir fallback directory of a socket path too long for sun_path (socketPathFor), once its socket is gone: removed
// only when empty, never recursively, so whatever another host put there stays.
function removeFallbackDirectory(socketPath: string, dir: string): void {
  if (dirname(socketPath) === dir) return;
  try {
    fs.rmdirSync(dirname(socketPath));
  } catch {
    // not empty, or already gone
  }
}

function unlinkQuietly(path: string): void {
  try {
    fs.unlinkSync(path);
  } catch {
    // already gone
  }
}

// Every console line of the host goes to its log (which rotates), not to the stdio descriptors its spawner opened on the
// log at the spawn (which would keep writing into the rotated file).
function routeConsole(log: (line: string) => void): void {
  const to =
    (prefix: string) =>
    (...args: unknown[]) =>
      log(`${prefix}${format(...args)}`);
  console.log = to('');
  console.info = to('');
  console.debug = to('debug: ');
  console.warn = to('warn: ');
  console.error = to('error: ');
}
