// The pty host's socket mode (P5 O2 M4; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md): the pty-host bundle run as
// Node with `--detached <dir>` (by `mawsd`, M5, as argv0 `maws-pty-host`) takes `<dir>`'s lock, writes its token,
// listens on its socket (files.ts) and serves one client at a time, exactly as the utility host serves main
// (@shared/host/socket-host). A wrong token is closed with nothing written. A client that listed `socket.ptyFrames`
// gets `pty.data` as binary frames.
//
// Its life: `exit {when: 'now'}` and SIGTERM end every live pty through the kill ladder (the exit order's shutdown) and
// exit. It never exits on its own and has no exit-when-idle (`exit idle` is logged and ignored): its client decides when
// it is idle (`mawsd` parks it when no app is attached and no pty is alive), so nothing has to disarm one. Its welcome
// counts the live ptys as `liveSessions` and every entry, the dead ones kept for a reload included, as `rows`, so a
// client of another build replaces one with nothing live and serves one whose terminals run.
import type { HostRegister } from '@shared/host/runtime';
import { runSocketHost, startSocketHost, type HostProcess, type SocketHost } from '@shared/host/socket-host';
import { PTY_HOST_FILES, ptyHostSocketPath } from './files';
import type { PtyTable } from './table';

export interface PtyHostDetachedOptions {
  dir: string; // <profile>/mawsd/pty-host
  modulePath: string; // this bundle's entry file, hashed into the build id
  log: (line: string) => void;
  table(): Pick<PtyTable, 'list' | 'shutdown'>; // the register's table, once it has run
}

export function runPtyHostDetached(hostVersion: string, register: HostRegister, opts: PtyHostDetachedOptions): void {
  runSocketHost(opts.log, (proc) => startPtyHost(hostVersion, register, opts, proc));
}

// lock → token → listen → serve; null when it exited instead (the lock held, a signal, or a socket it could not make).
export function startPtyHost(hostVersion: string, register: HostRegister, opts: PtyHostDetachedOptions, proc: HostProcess): Promise<SocketHost | null> {
  const { dir, log } = opts;
  return startSocketHost(
    {
      kind: 'pty host',
      hostVersion,
      dir,
      files: PTY_HOST_FILES,
      socketPath: ptyHostSocketPath(dir),
      modulePath: opts.modulePath,
      register,
      badToken: 'close', // nothing before the token (P5 O2 M3, RL §5.11)
      counts: () => {
        const { ptys } = opts.table().list();
        return { liveSessions: ptys.filter((pty) => pty.alive).length, rows: ptys.length };
      },
      shutdown: () => opts.table().shutdown(),
      exitWhenIdle: () => log('exit when idle ignored: the pty host exits only when its client says now'),
      log,
    },
    proc,
  );
}
