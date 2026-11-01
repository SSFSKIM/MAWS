// Who is on the other end of the cua socket (cua docs/doperpowers/specs/2026-10-09-maws-socket-peer-auth-design.md,
// "The addon" and "The policy"): the loader of the peer identity addon (native/peer-auth/peer-auth.c, three system calls)
// and the policy over it, the same in shape as cua's src/chrome/peer.mjs. A peer is accepted by where it sits in the
// process tree: it runs as this user and descends from a root, a process instance (pid and start time) captured when it
// became known and re-verified on every walk, so a root whose pid now names another process matches nothing. The kernel
// reports the peer's pid and uid; the process table each process's parent and start time. Nothing here logs.
//
// P5 O5 M5 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §H): beside the roots, one relay peer, the
// attached `mawsd`, which checks the engine's peer at its own socket and relays the connection from its own process. It
// is admitted by its exact instance (pid and kernel start), never as a root: every engine on the machine descends from
// the daemon, so its descendants are walked as any peer's. `mawsd` loads this module too, for its own sockets' check.
//
// P5 O17 M2 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md §H; condition 5 of O5's M7 verdict): where no addon
// exists for the platform (Linux), the uid is the boundary (O2's rule), `judgeUidPeer`: never a stand-in addon.
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { assertPrivateSocket } from '@shared/host/private-path';

// Pins the addon's exported `version`; an addon reporting another is refused at load (fail closed).
export const PEER_AUTH_VERSION = 1;
export const ANCESTRY_LIMIT = 64; // parents walked up from the peer at most
export const PEER_ROOT_WAIT_MS = 3000; // how long an accepted socket waits for its session's root (M2)

export type ProcessRoot = { pid: number; start: number };
export type PeerRefusalReason = 'module_unavailable' | 'peer_unavailable' | 'uid_mismatch' | 'no_root' | 'not_descendant' | 'not_private';
export type PeerRefusal = { reason: PeerRefusalReason; pid: number | null; detail?: string }; // detail: what was not private
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

// The root (the object in `roots`) that `pid`, or a parent of it at most ANCESTRY_LIMIT steps up, is, with its live start
// the stored one: the nearest such ancestor, or null. The walk ends at launchd (1), the kernel (0), a gone process or the
// limit.
export function descendantRoot(pid: number, roots: readonly ProcessRoot[], lookup: ProcessLookup): ProcessRoot | null {
  let current = pid;
  for (let steps = 0; steps <= ANCESTRY_LIMIT; steps += 1) {
    if (current === 0 || current === 1) return null;
    const info = lookup(current);
    if (!info) return null;
    const root = roots.find((candidate) => candidate.pid === current && candidate.start === info.start);
    if (root) return root;
    current = info.ppid;
  }
  return null;
}

export const descends = (pid: number, roots: readonly ProcessRoot[], lookup: ProcessLookup): boolean => descendantRoot(pid, roots, lookup) !== null;

// What let an accepted peer in, as the check saw it (never looked up again: the tree can change right after): the relay's
// exact instance, or the root it descends from (the object passed in `roots`).
// `uid`: the uid boundary's (P5 O17 M2), any process of this user that reached the socket.
export type PeerAdmission = { via: 'relay' } | { via: 'root'; root: ProcessRoot } | { via: 'uid' };

type PeerCheck = { addon: PeerAddon | null; now: number; uid: number; relay?: ProcessRoot | null };

// The verdict on an accepted socket's peer: the first refusal, or null to accept. `roots` is every root the socket
// answers to (a session's engine beside any trusted root); `now` is the accept time in milliseconds since the epoch, and
// `uid` this process's user; `relay` the attached daemon's instance, admitted as itself alone (P5 O5 M5).
export function authorizePeer(fd: number | null | undefined, roots: readonly ProcessRoot[], check: PeerCheck): PeerRefusal | null {
  const verdict = judgePeer(fd, roots, check);
  return 'reason' in verdict ? verdict : null;
}

// authorizePeer's verdict with what admitted the peer: the refusal, or the admission.
export function judgePeer(
  fd: number | null | undefined,
  roots: readonly ProcessRoot[],
  { addon, now, uid, relay = null }: PeerCheck,
): PeerRefusal | PeerAdmission {
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
  // the daemon's relay, by its exact instance; its pid with another start is a stranger, judged as any peer below. Held
  // to the accept-time rule too: a daemon started after the accept did not connect (the socket's pid is reused)
  if (relay !== null && pid === relay.pid && isLive(relay, addon.process)) {
    if (relay.start > now * 1000) return { reason: 'not_descendant', pid };
    return read()?.pid === pid ? { via: 'relay' } : { reason: 'not_descendant', pid };
  }
  const live = roots.filter((root) => isLive(root, addon.process));
  if (live.length === 0) return { reason: 'no_root', pid };
  // A peer started after the accept is not the process that connected: that one is gone and its pid reused.
  const info = addon.process(pid);
  const root = info && info.start <= now * 1000 ? descendantRoot(pid, live, addon.process) : null;
  if (!root) return { reason: 'not_descendant', pid };
  // LOCAL_PEERPID names the peer socket's last operator: a descriptor handed to another process during the walk shows here.
  if (read()?.pid !== pid) return { reason: 'not_descendant', pid };
  return { via: 'root', root };
}

// The uid boundary (P5 O17 M2), where no addon exists for the platform (Linux): the socket is 0600 in a 0700 directory
// this uid owns, read by lstat at each accept (never through a symlink, no other owner, no wider mode), and the peer runs
// as this uid where the platform reports it (an addon that reads the peer). It bounds the user, not the session: any
// process of this uid that can reach the path is let in, which is what the policy states.
export function judgeUidPeer(fd: number | null | undefined, socketPath: string, { addon, uid }: { addon: PeerAddon | null; uid: number }): PeerRefusal | PeerAdmission {
  try {
    assertPrivateSocket(socketPath, { uid });
  } catch (error) {
    return { reason: 'not_private', pid: null, detail: error instanceof Error ? error.message : String(error) };
  }
  if (!addon) return { via: 'uid' };
  const read = (): { pid: number; uid: number } | null => {
    try {
      return typeof fd === 'number' ? addon.peer(fd) : null;
    } catch {
      return null;
    }
  };
  const peer = read();
  if (!peer) return { reason: 'peer_unavailable', pid: null };
  return peer.uid === uid ? { via: 'uid' } : { reason: 'uid_mismatch', pid: peer.pid };
}
