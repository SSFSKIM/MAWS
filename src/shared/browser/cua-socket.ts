// A session's cua socket (E13): `<dir>/<appSessionId>.sock` in the app's cua socket directory, `<userData>/browser/cua`.
// The app listens on it (src/main/browser/cua); the spine tells a launch its path, in main on the embedded shape and in
// `mawsd` on the daemon shape, which learns the directory from the app's `machine.client` (P5 O3-D M5b). None for a path
// longer than a Unix socket allows.
//
// P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §H): on the daemon shape a launch is told
// `mawsd`'s own socket for the session, in the daemon's cua directory (DAEMON_CUA_DIR under @shared/daemon/files'
// cuaSocketDir), which `mawsd` relays to the attached app's socket above; the app's path stays the embedded shape's and
// the relay's target.
//
// P5 O17 (the session sockets' names, 2026-11-03; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Surprises, "the
// session sockets' sun_path overflow"): a socket `mawsd` owns for a session (its own in the cua directory, and the render
// host's, whose path `mawsd` gives in `prepare`) is named by a digest of the session id, `<16 hex of its sha256>.sock`,
// 21 bytes where the uuid's name is 41, so both fit a Mac's default profile and the 48-byte per-user TMPDIR fallback.
// Only `mawsd` derives it: a launch is told its path, and the render host listens where `prepare` names. The app's own socket keeps
// the uuid (`cuaSocketPath`): `mawsd` relays to the path the app's build computes, a convention across builds.
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const CUA_SOCKET_DIR = ['browser', 'cua'] as const; // under the profile

// sockaddr_un's sun_path on macOS is 104 bytes, the terminating NUL included.
export const MAX_SOCKET_PATH_BYTES = 103;

export function cuaSocketPath(dir: string, appSessionId: string): string | null {
  const path = join(dir, `${appSessionId}.sock`);
  return Buffer.byteLength(path) > MAX_SOCKET_PATH_BYTES ? null : path;
}

export const DAEMON_CUA_DIR = 'cua'; // under the daemon's socket directory (cuaSocketDir); 0700, its sockets 0600

// A mawsd-owned socket's name for a session: 64 bits of the id's sha256, which no two of a machine's sessions share in
// practice (the host set's 10,000 sessions collide with a chance of about 3e-12)
export const DAEMON_SESSION_SOCKET_NAME = /^[0-9a-f]{16}\.sock$/; // every such name's shape, which the render host checks
export function daemonSessionSocketName(appSessionId: string): string {
  return `${createHash('sha256').update(appSessionId).digest('hex').slice(0, 16)}.sock`;
}

// A mawsd-owned socket for a session in `dir` (the cua directory, or the render host's): none past sun_path (the
// daemon logs it, and the launch carries none or the capability names it).
export function daemonCuaSocketPath(dir: string, appSessionId: string): string | null {
  const path = join(dir, daemonSessionSocketName(appSessionId));
  return Buffer.byteLength(path) > MAX_SOCKET_PATH_BYTES ? null : path;
}
