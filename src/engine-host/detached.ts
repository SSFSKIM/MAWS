// The engine host's detached mode, the supervisor (E10 execution document, §Design 1 and 2). Main spawns the engine-host
// bundle under the Electron binary as Node with `--detached <supervisorDir>`; the process takes the lock, writes a
// fresh token, listens on its Unix socket and serves one client at a time through C1's runtime, so every handler runs
// exactly as in a utility process. It outlives the app: the engines it holds keep running while no app is connected.
//
// One exit order for every reason: (1) the server stops accepting; (2) every live row is stopped through
// engine.shutdown's body (grace 3 s) and the plugin runner with it; (3) the orphan ledger is cleared if this process
// still owns it; (4) the socket file and the lock are unlinked if the lock still names this process (a successor that
// replaced a stale lock keeps its files); (5) the client is closed; (6) exit 0. A fatal error exits 1 and skips (3)
// and (4), so the successor's staleness check finds the lock and the ledger.
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { format } from 'node:util';
import { createHostRuntime, type HostRegister } from '@shared/host/runtime';
import { serveSocketClients } from '@shared/host/socket-server';
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { clearLive, type Owner } from './live-ledger';
import { buildIdOf, isAlive, procStartOf, readLock, socketPathFor, START_EXIT_HELD, SUPERVISOR_FILES, takeLock } from './supervisor-files';

export { BREAK_STALE_MS, buildIdOf, socketPathFor, START_EXIT_HELD, takeLock, type LockDeps, type LockFile } from './supervisor-files';

export interface DetachedOptions {
  dir: string; // <userData>/supervisor
  modulePath: string; // this bundle's entry file, hashed into the build id
  idleExitMs: number; // exit after this long with no client and no live row; not finite or ≤ 0: never
  log: (line: string) => void;
  // How the entry reaches the engine's process table (the welcome's counts, the idle clock, the exit order's ladder).
  counts(): { liveSessions: number; rows: number };
  shutdown(graceMs: number): Promise<void>; // engine.shutdown's body: every live row's ladder and the plugin runner
}

export type ExitReason = 'idle' | 'stopAll' | 'exit' | 'exitWhenIdle' | 'fatal' | 'signal';

export interface RunningSupervisor {
  socketPath: string;
  stop(reason: ExitReason, code?: 0 | 1): Promise<void>; // the exit order; a second call joins the first
}

export interface SupervisorProcess {
  exit(code: number): void;
  aborted?(): boolean; // a SIGTERM arrived while the start was under way
}

// The exit code of a start a SIGTERM aborted (128 + SIGTERM): its lock, if it took one, is already removed.
export const START_EXIT_ABORTED = 143;

export const EXIT_GRACE_MS = 3_000; // the exit order's ladder grace for every live row
const EXIT_SHUTDOWN_BOUND_MS = 10_000; // past this the exit order goes on without the ladder's answer

// The detached entry: routes console into the log, treats an uncaught exception as fatal and SIGTERM as an exit, and
// starts the supervisor. Exit codes: 0 clean, 1 fatal, START_EXIT_HELD (3) when another supervisor holds the lock,
// START_EXIT_ABORTED (143) when a SIGTERM arrived during the start (main reads 1 and 143 as an unexpected exit).
export function runDetached(hostVersion: string, register: HostRegister, opts: DetachedOptions): void {
  routeConsole(opts.log);
  const proc: SupervisorProcess = { exit: (code) => process.exit(code) };
  let supervisor: RunningSupervisor | null = null;
  const fatal = (error: unknown) => {
    opts.log(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    if (supervisor) void supervisor.stop('fatal', 1);
    else proc.exit(1);
  };
  process.on('uncaughtException', fatal);
  // A stray rejection is logged, not fatal: a supervisor holding sessions outlives a bug in one of them.
  process.on('unhandledRejection', (reason) => opts.log(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`));
  // A SIGTERM during the start does not exit past takeLock's cleanup: the start sees it at its next step and aborts.
  let abortRequested = false;
  proc.aborted = () => abortRequested;
  process.on('SIGTERM', () => {
    if (supervisor) void supervisor.stop('signal');
    else abortRequested = true;
  });
  startSupervisor(hostVersion, register, opts, proc).then((started) => {
    supervisor = started;
    if (started && abortRequested) void started.stop('signal'); // the signal landed between listen and this line
  }, fatal);
}

// lock → token → listen → serve; null when it exited instead (the lock held, or the socket could not be created).
export async function startSupervisor(hostVersion: string, register: HostRegister, opts: DetachedOptions, proc: SupervisorProcess): Promise<RunningSupervisor | null> {
  const { dir, log } = opts;
  const pid = process.pid;
  privateDirectory(dir);
  const buildId = buildIdOf(opts.modulePath);
  const socketPath = socketPathFor(dir, dirname(dir), tmpdir());
  log(`supervisor ${hostVersion} pid ${pid} build ${buildId} starting in ${dir}`);

  const lockDeps = { fs, isAlive, procStartOf, now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };
  if ((await takeLock(dir, { protocol: SOCKET_PROTOCOL, buildId, socketPath }, lockDeps)) === 'held') {
    log(`another supervisor (pid ${readLock(dir)?.pid ?? 'unknown'}) holds the lock; exiting ${START_EXIT_HELD}`);
    proc.exit(START_EXIT_HELD);
    return null;
  }
  // The owner and start time as the lock recorded them, so the exit order's ownership check compares like with like
  // even if a later `ps` of this process fails.
  const written = readLock(dir);
  const owner: Owner = { pid, procStart: written?.pid === pid ? written.procStart : '' };
  const startedAt = written?.startedAt ?? new Date().toISOString();
  const lockNamesMe = (): boolean => {
    const lock = readLock(dir);
    return lock !== null && lock.pid === owner.pid && lock.procStart === owner.procStart;
  };
  const abortStart = (stage: string): null => {
    log(`start aborted by a signal ${stage}; exiting ${START_EXIT_ABORTED}`);
    if (lockNamesMe()) unlinkQuietly(join(dir, SUPERVISOR_FILES.lock));
    proc.exit(START_EXIT_ABORTED);
    return null;
  };
  if (proc.aborted?.()) return abortStart('after taking the lock');
  const token = writeToken(dir);
  if (dirname(socketPath) !== dir) privateDirectory(dirname(socketPath));
  try {
    fs.unlinkSync(socketPath); // a socket file left by a dead supervisor; no live one can own it, since we hold the lock
  } catch {
    // none, or something listen will report
  }

  const runtime = createHostRuntime(register);
  const server = createServer();
  let stopping: Promise<void> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clients = serveSocketClients(server, {
    runtime,
    identity: () => ({ protocol: SOCKET_PROTOCOL, buildId, wire: wireFingerprint(), pid, startedAt }),
    counts: () => opts.counts(),
    token: () => token,
    onExit: (when) => {
      if (when === 'now') void stop('exit');
      else log('exit when idle asked; not served until the idle clocks land (E10 M2)');
    },
    onClient: (connected) => (connected ? clearIdle() : armIdle()),
    log,
  });

  function clearIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  // The idle clock: no client and no live row for idleExitMs. Checked when it fires, not trusted blindly; a live row
  // re-arms it (M2 starts it at the last row's exit and adds the idle-row release and exit-when-idle).
  function armIdle(): void {
    clearIdle();
    if (stopping || !Number.isFinite(opts.idleExitMs) || opts.idleExitMs <= 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (clients.connected()) return;
      if (opts.counts().liveSessions > 0) return armIdle();
      void stop('idle');
    }, opts.idleExitMs);
  }

  function stop(reason: ExitReason, code: 0 | 1 = 0): Promise<void> {
    stopping ??= (async () => {
      log(`exiting (${reason})`);
      clearIdle();
      server.close(); // (1) no new client; the callback would wait for the client, which (5) closes
      try {
        await Promise.race([opts.shutdown(EXIT_GRACE_MS), new Promise((resolve) => setTimeout(resolve, EXIT_SHUTDOWN_BOUND_MS).unref())]); // (2)
      } catch (error) {
        log(`stopping the sessions failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (code === 0) {
        clearLive(dir, owner); // (3)
        if (lockNamesMe()) {
          unlinkQuietly(socketPath); // (4) usually gone already: Node unlinks a listening path when its server closes
          unlinkQuietly(join(dir, SUPERVISOR_FILES.lock));
        }
      }
      clients.closeClient(); // (5)
      proc.exit(code); // (6)
    })();
    return stopping;
  }

  try {
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
  armIdle();
  return { socketPath, stop };
}

function privateDirectory(path: string): void {
  fs.mkdirSync(path, { recursive: true, mode: 0o700 });
  fs.chmodSync(path, 0o700); // a pre-existing directory is corrected too
}

// 32 random bytes as hex, written through a temporary file so a reader never sees half a token.
function writeToken(dir: string): string {
  const token = randomBytes(32).toString('hex');
  const path = join(dir, SUPERVISOR_FILES.token);
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

function unlinkQuietly(path: string): void {
  try {
    fs.unlinkSync(path);
  } catch {
    // already gone
  }
}

// Every console line of the host goes to the supervisor's log (which rotates), not to the stdio descriptors main
// opened on host.log at the spawn (which would keep writing into the rotated file).
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
