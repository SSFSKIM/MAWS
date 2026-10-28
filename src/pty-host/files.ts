// The pty host's files in socket mode (P5 O2 M4; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, Orientation "The
// daemon shape"): its directory `<profile>/mawsd/pty-host/` (0700) holds `host.lock`, `host.token`, `host.sock` and
// `host.log`, the engine host's names in a directory of its own. A socket path past sun_path falls back to
// `$TMPDIR/maws-pty-host-<12 hex of the directory's sha1>/host.sock`, never the engine host's fallback directory. This
// module loads nothing of the pty host itself (no node-pty), so `mawsd`, which reaches the pty host, can import it.
import { tmpdir } from 'node:os';
import { socketPathFor, SUPERVISOR_FILES } from '../engine-host/supervisor-files';
import type { HostFiles } from '@shared/host/detached-transport';

export const PTY_HOST_FILES = {
  socket: SUPERVISOR_FILES.socket,
  lock: SUPERVISOR_FILES.lock,
  breaker: SUPERVISOR_FILES.breaker,
  token: SUPERVISOR_FILES.token,
  log: SUPERVISOR_FILES.log,
} as const;

// The socket the pty host in `dir` listens on, as its lock records it.
export function ptyHostSocketPath(dir: string, tmp: string = tmpdir()): string {
  return socketPathFor(dir, dir, tmp, 'maws-pty-host');
}

// The file set a client's transport reaches the pty host in `dir` by.
export function ptyHostFiles(dir: string): HostFiles {
  return { dir, lock: PTY_HOST_FILES.lock, token: PTY_HOST_FILES.token, socket: ptyHostSocketPath(dir), log: PTY_HOST_FILES.log };
}
