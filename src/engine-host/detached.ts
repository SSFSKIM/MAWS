// The engine host's detached mode, the supervisor (E10 execution document, §Design 1 and 2). Main spawns the engine-host
// bundle under the Electron binary as Node with `--detached <supervisorDir>`; the process takes the lock, writes a
// fresh token, listens on its Unix socket and serves one client at a time through C1's runtime, so every handler runs
// exactly as in a utility process. It outlives the app: the engines it holds keep running while no app is connected.
//
// One exit order for every reason: (1) the server stops accepting; (2) every live row is stopped through
// engine.shutdown's body (grace 3 s) and the plugin runner with it; (3) the orphan ledger is cleared if this process
// still owns it; (4) the socket file, its tmpdir fallback directory when empty, and the lock are removed if the lock
// still names this process (a successor that replaced a stale lock keeps its files); (5) the client is closed; (6) exit 0. A fatal error exits 1 and skips (3)
// and (4), so the successor's staleness check finds the lock and the ledger.
//
// When to exit is not decided here: the engine host's Supervision (supervision.ts) holds the idle exit, exit-when-idle
// and host.stopAll, and this entry tells it (`life`) when it serves, who connects and what a client asks.
//
// Task 2.5: after listen the orphan sweep reads the predecessor's ledger (live.json) and, when that supervisor is dead,
// stops the engines it left; once the sweep has ended the engine host's table records this supervisor's own ledger
// (`life.orphansSwept`). A welcomed client drops the cached login-shell capture, so the next launch captures again.
//
// P5 O2 M3 (RL §5.11): the directory and the socket's directory are created 0700 when missing and checked before the
// lock, the token and the listen (@shared/host/private-path): a symlink, another owner or a mode wider than 0700 stops
// the start (exit 1, the log naming the path). One that exists is no longer corrected to 0700. Before the listen, the
// socket path may hold nothing or this uid's stale socket (removed); a symlink, a file or another uid's socket is
// refused and left in place (@shared/host/private-listen).
//
// P5 O2 M4: the lock, the token, the listen and the exit order are @shared/host/socket-host's, which the pty host's
// socket mode shares; this entry keeps the orphan ledger (the exit order's clean step), the sweep and Supervision.
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { invalidateShellEnvironment } from '@shared/host/shell-env';
import { runSocketHost, START_EXIT_ABORTED, startSocketHost, type HostProcess } from '@shared/host/socket-host'; // P5 O2 M4
import { SOCKET_PROTOCOL } from '@shared/host/socket-protocol';
import type { HostRegister } from '@shared/host/runtime';
import { wireFingerprint } from '@shared/ipc/wire-fingerprint';
import { clearLive, signalOrphan, sweepOrphans, writeLive, type LiveRow } from './live-ledger';
import { isAlive, procStartOf, socketPathFor, SUPERVISOR_FILES } from './supervisor-files';
import type { SupervisorExit, SupervisorIdentity } from './supervision';

export { BREAK_STALE_MS, buildIdOf, socketPathFor, START_EXIT_HELD, takeLock, type LockDeps, type LockFile } from './supervisor-files';
export { START_EXIT_ABORTED };

export interface DetachedOptions {
  dir: string; // <userData>/supervisor
  modulePath: string; // this bundle's entry file, hashed into the build id
  log: (line: string) => void;
  // How the entry reaches the engine's process table (the welcome's counts, the exit order's ladder).
  counts(): { liveSessions: number; rows: number };
  shutdown(graceMs: number): Promise<unknown>; // engine.shutdown's body: every live row's ladder and the plugin runner
  life: SupervisorLife;
}

// The supervisor's own life as the engine host decides it (supervision.ts), told what only this entry knows.
export interface SupervisorLife {
  started(identity: SupervisorIdentity, exit: (reason: SupervisorExit) => void): void; // serving; `exit` runs the exit order
  clientChanged(connected: boolean): void; // a client was welcomed, or the client left
  exitWhenIdle(): void; // a client's `exit {when: 'idle'}`
  // the start-up sweep ended: how many orphans it stopped, and the writer of this supervisor's own ledger, which the
  // engine host's table takes from here on (writing it before the sweep read the predecessor's would lose its rows)
  orphansSwept(killed: number, recordLive: (rows: readonly LiveRow[]) => void): void;
}

export type ExitReason = SupervisorExit | 'exit' | 'fatal' | 'signal';

export interface RunningSupervisor {
  socketPath: string;
  stop(reason: ExitReason, code?: 0 | 1): Promise<void>; // the exit order; a second call joins the first
}

export type SupervisorProcess = HostProcess;

export const EXIT_GRACE_MS = 3_000; // the exit order's ladder grace for every live row

// The detached entry (@shared/host/socket-host's process wiring). Exit codes: 0 clean, 1 fatal, START_EXIT_HELD (3) when
// another supervisor holds the lock, START_EXIT_ABORTED (143) when a SIGTERM arrived during the start (main reads 1 and
// 143 as an unexpected exit).
export function runDetached(hostVersion: string, register: HostRegister, opts: DetachedOptions): void {
  runSocketHost(opts.log, (proc) => startSupervisor(hostVersion, register, opts, proc));
}

// lock → token → listen → serve, then the sweep; null when it exited instead (the lock held, or the socket could not
// be created).
export async function startSupervisor(hostVersion: string, register: HostRegister, opts: DetachedOptions, proc: SupervisorProcess): Promise<RunningSupervisor | null> {
  const { dir, log } = opts;
  return startSocketHost(
    {
      kind: 'supervisor',
      hostVersion,
      dir,
      files: SUPERVISOR_FILES,
      socketPath: socketPathFor(dir, dirname(dir), tmpdir()),
      modulePath: opts.modulePath,
      register,
      badToken: 'refuse', // E10's `refuse token` (P5 Decision Log 29)
      counts: () => opts.counts(),
      shutdown: () => opts.shutdown(EXIT_GRACE_MS), // (2) every live row stopped (grace 3 s) and the plugin runner with it
      clean: (owner) => clearLive(dir, owner), // the orphan ledger, if this process still owns it
      exitWhenIdle: () => opts.life.exitWhenIdle(),
      onClient: (connected) => {
        if (connected) invalidateShellEnvironment(); // the owner is back: the next launch captures the shell again
        opts.life.clientChanged(connected);
      },
      // the predecessor's ledger is read here, synchronously, before anything can launch; its orphans are stopped in the
      // background (up to the sweep's grace) while this supervisor already serves
      listening: (host) => {
        const sweep = sweepOrphans(dir, { isAlive, procStartOf, signal: signalOrphan, sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)), log });
        const { pid } = host.owner;
        opts.life.started({ pid, startedAt: host.startedAt, buildId: host.buildId, protocol: SOCKET_PROTOCOL, wire: wireFingerprint(), socketPath: host.socketPath, logPath: join(dir, SUPERVISOR_FILES.log) }, (reason) => void host.stop(reason));
        void sweep.then((killed) => {
          if (!host.stopping()) opts.life.orphansSwept(killed, (rows) => writeLive(dir, host.owner, rows)); // an exit under way records nothing
        });
      },
      log,
    },
    proc,
  );
}
