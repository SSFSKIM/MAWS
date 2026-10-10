// Who is on the other end of the cua socket (cua docs/doperpowers/specs/2026-10-09-maws-socket-peer-auth-design.md,
// "The addon" and "The policy"): the loader of the peer identity addon (native/peer-auth/peer-auth.c, three system calls)
// and the policy over it, the same in shape as cua's src/chrome/peer.mjs. A peer is accepted by where it sits in the
// process tree: it runs as this user and descends from a root, a process instance (pid and start time) captured when it
// became known and re-verified on every walk, so a root whose pid now names another process matches nothing. The kernel
// reports the peer's pid and uid; the process table each process's parent and start time. Nothing here logs.
import type { Socket } from 'node:net';
import { join } from 'node:path';

// Pins the addon's exported `version`; an addon reporting another is refused at load (fail closed).
export const PEER_AUTH_VERSION = 1;
export const ANCESTRY_LIMIT = 64; // parents walked up from the peer at most
export const PEER_ROOT_WAIT_MS = 3000; // how long an accepted socket waits for its session's root (M2)

export type ProcessRoot = { pid: number; start: number };
export type PeerRefusalReason = 'module_unavailable' | 'peer_unavailable' | 'uid_mismatch' | 'no_root' | 'not_descendant';
export type PeerRefusal = { reason: PeerRefusalReason; pid: number | null };
export type ProcessLookup = (pid: number) => { ppid: number; start: number } | null;

// The addon's exports. `start` is microseconds since the epoch; `process` is null for a gone or unreadable pid; `peer`
// throws a plain Error carrying the system error.
export interface PeerAddon {
  peer(fd: number): { pid: number; uid: number };
  process: ProcessLookup;
  version: number;
}

// Where the prebuild lives: the packaged app's resources (electron-builder.yml's extraResources), or the committed
// prebuild under the development app root.
export function peerAddonPath({ packaged, resourcesPath, appRoot }: { packaged: boolean; resourcesPath: string; appRoot: string }): string {
  if (packaged) return join(resourcesPath, 'peer-auth', 'peer-auth.node');
  return join(appRoot, 'native', 'peer-auth', 'prebuilds', 'darwin-arm64', 'peer-auth.node');
}

// The addon, or null when it cannot serve: not Apple silicon macOS (not tried), a missing or unloadable file, or exports
// of another shape or version.
export function loadPeerAddon(path: string, host: { platform: string; arch: string } = process): PeerAddon | null {
  if (host.platform !== 'darwin' || host.arch !== 'arm64') return null;
  const module = { exports: {} as Partial<PeerAddon> };
  try {
    process.dlopen(module, path);
  } catch {
    return null;
  }
  const { peer, process: lookup, version } = module.exports;
  if (typeof peer !== 'function' || typeof lookup !== 'function' || version !== PEER_AUTH_VERSION) return null;
  return { peer, process: lookup, version };
}

// The live instance of `pid` as a root, or null when the process is gone.
export function rootOf(pid: number, addon: PeerAddon): ProcessRoot | null {
  const info = addon.process(pid);
  return info ? { pid, start: info.start } : null;
}

// The accepted socket's descriptor (libuv's pipe handle exposes it; Node offers no peer credentials of its own).
export function socketFd(socket: Socket): number | null {
  const fd = (socket as unknown as { _handle?: { fd?: unknown } })._handle?.fd;
  return typeof fd === 'number' && fd >= 0 ? fd : null;
}

const isLive = (root: ProcessRoot, lookup: ProcessLookup): boolean => lookup(root.pid)?.start === root.start;

// Whether `pid`, or a parent of it at most ANCESTRY_LIMIT steps up, is a root whose live start is the stored one. The
// walk ends at launchd (1), the kernel (0), a gone process or the limit.
export function descends(pid: number, roots: readonly ProcessRoot[], lookup: ProcessLookup): boolean {
  let current = pid;
  for (let steps = 0; steps <= ANCESTRY_LIMIT; steps += 1) {
    if (current === 0 || current === 1) return false;
    const info = lookup(current);
    if (!info) return false;
    if (roots.some((root) => root.pid === current && root.start === info.start)) return true;
    current = info.ppid;
  }
  return false;
}

// The verdict on an accepted socket's peer: the first refusal, or null to accept. `roots` is every root the socket
// answers to (a session's engine beside any trusted root); `now` is the accept time in milliseconds since the epoch, and
// `uid` this process's user.
export function authorizePeer(
  fd: number | null | undefined,
  roots: readonly ProcessRoot[],
  { addon, now, uid }: { addon: PeerAddon | null; now: number; uid: number },
): PeerRefusal | null {
  if (!addon) return { reason: 'module_unavailable', pid: null };
  const read = (): { pid: number; uid: number } | null => {
    if (typeof fd !== 'number') return null;
    try {
      return addon.peer(fd);
    } catch {
      return null;
    }
  };
  const peer = read();
  if (!peer) return { reason: 'peer_unavailable', pid: null };
  const { pid } = peer;
  if (peer.uid !== uid) return { reason: 'uid_mismatch', pid };
  const live = roots.filter((root) => isLive(root, addon.process));
  if (live.length === 0) return { reason: 'no_root', pid };
  // A peer started after the accept is not the process that connected: that one is gone and its pid reused.
  const info = addon.process(pid);
  if (!info || info.start > now * 1000 || !descends(pid, live, addon.process)) return { reason: 'not_descendant', pid };
  // LOCAL_PEERPID names the peer socket's last operator: a descriptor handed to another process during the walk shows here.
  if (read()?.pid !== pid) return { reason: 'not_descendant', pid };
  return null;
}
