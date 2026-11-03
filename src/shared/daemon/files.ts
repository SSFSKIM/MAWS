// `mawsd`'s files (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, Orientation "The daemon shape" and
// Interfaces "The profile and the files"). `<profile>/mawsd/` (0700) holds `mawsd.lock`, `mawsd.token` (0600), the
// sockets (0600), `mawsd.log` (rotated to `.1` at 8 MiB), `mawsd.out`, `endpoint/` (0700, O10's), `pty-host/` (0700, the
// pty host's own files) and `bin/`. The machine's identity is the profile's (`<profile>/machine.json`,
// @shared/machine/identity-file), not here. When the longest socket path would pass sun_path, every socket falls back
// together to `$TMPDIR/maws-mawsd-<12 hex of the profile's sha1>/`, as the supervisor's socket does (socketPathFor), so
// they never split between two directories. P5 O5 M2: the sockets are the three a host's transport reaches (`sockets`)
// and the artifact endpoint's `artifacts.sock` (`artifactsSocket`, HTTP: docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md,
// Interfaces §C), which no transport reaches. P5 O5 M5 (Interfaces §H): the per-session cua sockets in `cuaSocketDir`,
// chosen by their own length rather than with the others, since a cua path is about 45 bytes longer. P5 O17 M4: the render
// host's in `renderCuaSocketDir`, chosen the same way.
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostFiles } from '../host/detached-transport';
import { SOCKET_PATH_MAX_BYTES } from '../../engine-host/supervisor-files';
import { DAEMON_CUA_DIR } from '../browser/cua-socket';

export const DAEMON_FILES = {
  dir: 'mawsd', lock: 'mawsd.lock', token: 'mawsd.token', log: 'mawsd.log', out: 'mawsd.out', // the identity file is the profile's (identity-file.ts)
  engineHostSocket: 'engine-host.sock', ptyHostSocket: 'pty-host.sock', machineSocket: 'machine.sock', artifactsSocket: 'artifacts.sock', // P5 O5 M2: artifactsSocket
  endpoint: 'endpoint', ptyHost: 'pty-host', bin: 'bin',
} as const;

// The lock's break file, beside it (takeLock's names).
export const DAEMON_LOCK_BREAKER = `${DAEMON_FILES.lock}.break`;

export type DaemonSocket = 'engine-host' | 'pty-host' | 'machine';

export interface DaemonPaths {
  profileDir: string;
  dir: string; // <profile>/mawsd
  socketDir: string; // `dir`, or the tmpdir fallback
  sockets: Record<DaemonSocket, string>;
  artifactsSocket: string; // P5 O5 M2: the artifact endpoint's, in `socketDir` with the others
  log: string;
  endpoint: string; // <profile>/mawsd/endpoint, the endpoint module's state directory
  ptyHost: string; // <profile>/mawsd/pty-host, the pty host's directory
}

const SOCKET_NAMES: Record<DaemonSocket, string> = { 'engine-host': DAEMON_FILES.engineHostSocket, 'pty-host': DAEMON_FILES.ptyHostSocket, machine: DAEMON_FILES.machineSocket };

export function daemonPaths(profileDir: string, tmp: string = tmpdir()): DaemonPaths {
  const dir = join(profileDir, DAEMON_FILES.dir);
  const longest = Math.max(...[...Object.values(SOCKET_NAMES), DAEMON_FILES.artifactsSocket].map((name) => Buffer.byteLength(join(dir, name), 'utf8')));
  const socketDir = longest <= SOCKET_PATH_MAX_BYTES ? dir : socketFallbackDir(profileDir, tmp);
  const sockets = Object.fromEntries(Object.entries(SOCKET_NAMES).map(([socket, name]) => [socket, join(socketDir, name)])) as Record<DaemonSocket, string>;
  return { profileDir, dir, socketDir, sockets, artifactsSocket: join(socketDir, DAEMON_FILES.artifactsSocket), log: join(dir, DAEMON_FILES.log), endpoint: join(dir, DAEMON_FILES.endpoint), ptyHost: join(dir, DAEMON_FILES.ptyHost) };
}

// P5 O5 M5: the directory of `mawsd`'s per-session cua sockets: `<profile>/mawsd/cua` when a session's socket there
// (`<uuid>.sock`) fits sun_path, else `cua` in the fallback directory (which may still be too long: a session's path is
// then none, @shared/browser/cua-socket's daemonCuaSocketPath).
const CUA_SOCKET_NAME = `${'0'.repeat(36)}.sock`; // an app session id, a uuid
export function cuaSocketDir(profileDir: string, tmp: string = tmpdir()): string {
  const inDaemon = join(profileDir, DAEMON_FILES.dir, DAEMON_CUA_DIR);
  return Buffer.byteLength(join(inDaemon, CUA_SOCKET_NAME), 'utf8') <= SOCKET_PATH_MAX_BYTES ? inDaemon : join(socketFallbackDir(profileDir, tmp), DAEMON_CUA_DIR);
}

// P5 O17 M4 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §D): the render host's per-session cua
// sockets (`<dir>/<appSessionId>.sock`, its backend's, which only mawsd's relay reaches): `<profile>/mawsd/render-cua`, or
// `render-cua` in the fallback directory, chosen by its own length as cuaSocketDir is.
const RENDER_CUA_DIR = 'render-cua';
export function renderCuaSocketDir(profileDir: string, tmp: string = tmpdir()): string {
  const inDaemon = join(profileDir, DAEMON_FILES.dir, RENDER_CUA_DIR);
  return Buffer.byteLength(join(inDaemon, CUA_SOCKET_NAME), 'utf8') <= SOCKET_PATH_MAX_BYTES ? inDaemon : join(socketFallbackDir(profileDir, tmp), RENDER_CUA_DIR);
}

// The directory a profile's sockets fall back to when `<profile>/mawsd/` is too long for them (also what the packaged
// e2e watches for the default profile, whichever directory its daemon took).
export function socketFallbackDir(profileDir: string, tmp: string = tmpdir()): string {
  return join(tmp, `maws-mawsd-${createHash('sha1').update(profileDir).digest('hex').slice(0, 12)}`);
}

// The file set a client's transport reaches one of `mawsd`'s sockets by: one lock and one token cover all three.
export function daemonHostFiles(paths: DaemonPaths, socket: DaemonSocket): HostFiles {
  return { dir: paths.dir, lock: DAEMON_FILES.lock, token: DAEMON_FILES.token, socket: paths.sockets[socket], log: DAEMON_FILES.log };
}
