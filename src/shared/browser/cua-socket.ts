// A session's cua socket (E13): `<dir>/<appSessionId>.sock` in the app's cua socket directory, `<userData>/browser/cua`.
// The app listens on it (src/main/browser/cua); the spine tells a launch its path, in main on the embedded shape and in
// `mawsd` on the daemon shape, which learns the directory from the app's `machine.client` (P5 O3-D M5b). None for a path
// longer than a Unix socket allows.
//
// P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §H): on the daemon shape a launch is told
// `mawsd`'s own socket for the session, `<cua dir>/<appSessionId>.sock` in the daemon's cua directory (DAEMON_CUA_DIR
// under @shared/daemon/files' cuaSocketDir), which `mawsd` relays to the attached app's socket above; the app's path
// stays the embedded shape's and the relay's target.
import { join } from 'node:path';

export const CUA_SOCKET_DIR = ['browser', 'cua'] as const; // under the profile

// sockaddr_un's sun_path on macOS is 104 bytes, the terminating NUL included.
export const MAX_SOCKET_PATH_BYTES = 103;

export function cuaSocketPath(dir: string, appSessionId: string): string | null {
  const path = join(dir, `${appSessionId}.sock`);
  return Buffer.byteLength(path) > MAX_SOCKET_PATH_BYTES ? null : path;
}

export const DAEMON_CUA_DIR = 'cua'; // under the daemon's socket directory (cuaSocketDir); 0700, its sockets 0600

// `mawsd`'s socket for a session: none past sun_path (the daemon logs it, and the launch carries none).
export function daemonCuaSocketPath(cuaDir: string, appSessionId: string): string | null {
  return cuaSocketPath(cuaDir, appSessionId);
}
