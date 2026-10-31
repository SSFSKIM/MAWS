// The cua server's peer check on Linux, where the peer identity addon does not exist (it is darwin-arm64 only). Without
// an addon `authorizePeer` refuses every peer (`module_unavailable`), so a tab engine on Linux needs a mode the server
// does not have: O2's rule for every other local socket there, the uid is the boundary (0600 socket, 0700 directory).
// This stand-in answers the process table from /proc truthfully, but cannot read the peer's pid (Node exposes no
// SO_PEERCRED): it reports the trusted root itself, with this process's uid, so the check reduces to "the trusted root
// is alive". A product version would read SO_PEERCRED through a Linux build of the addon, or give the server an
// explicit uid-only policy.
import { readFileSync } from 'node:fs';
import type { PeerAddon } from '../../../src/main/browser/cua/peer';

const ticksPerSecond = 100; // USER_HZ on every Linux the devcloud images run
const bootSeconds = (() => {
  const line = readFileSync('/proc/stat', 'utf8').split('\n').find((l) => l.startsWith('btime '));
  return line ? Number(line.split(/\s+/)[1]) : 0;
})();

function processOf(pid: number): { ppid: number; start: number } | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' '); // after "pid (comm) "
    const ppid = Number(fields[1]);
    const startTicks = Number(fields[19]);
    return { ppid, start: Math.round((bootSeconds + startTicks / ticksPerSecond) * 1e6) };
  } catch {
    return null;
  }
}

export function linuxUidPeerAddon(trustedPid: number): PeerAddon {
  return { version: 1, process: processOf, peer: () => ({ pid: trustedPid, uid: process.getuid?.() ?? -1 }) };
}
