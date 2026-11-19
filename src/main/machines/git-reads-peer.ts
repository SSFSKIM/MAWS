// Whether this Mac's machine serves the git reads (UX wave U5b-2, M8; docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md
// §D, "This Mac's daemon"). Another machine serves `git.branchCommits`, `git.commitDiff` and `git.changesSince` when its
// RL2 handshake lists `rl2.git-reads` (remote lane B checks it, src/main/lane-b/remote.ts). This Mac's own daemon may be
// of another build (`watchDaemon` leaves another bundle's daemon running); its welcome lists no capability for them, and
// its wire minor says it, since the reads came at GIT_READS_MINOR (src/shared/ipc/wire.ts). So the local machine's state
// carries the same capability while its daemon serves them, and the window asks one question of every machine. No hook
// refuses the reads on the route: a daemon that does not know a name answers `unknown_command` by itself. The shape is
// the project acts' (./project-acts-peer.ts).
import { GIT_READS_CAPABILITY } from '@shared/ipc/schema/git';
import type { WirePeer } from '@shared/ipc/wire';

/** The wire minor whose daemon serves the three reads (src/shared/ipc/wire.ts's 54). */
export const GIT_READS_MINOR = 54;

/** What the connection manager reads as a machine's capabilities (`localCapabilities`). */
export type CapabilitySource = { read(): readonly string[] | null; onChange(listener: () => void): () => void };

/**
 * This Mac's machine's capabilities as far as the reads go: served by a daemon whose welcome is of the reads' minor or
 * later; none by an older one; null while no daemon has welcomed.
 */
export function localGitReads(peer: Pick<WirePeer, 'minor'> | null): readonly string[] | null {
  if (peer === null) return null;
  return peer.minor >= GIT_READS_MINOR ? [GIT_READS_CAPABILITY] : [];
}

/** The same from the attached daemon's welcome, heard again at each of its state's changes. */
export function localGitReadsSource(hosts: { peer(owner: 'machine'): Pick<WirePeer, 'minor'> | null; onState(owner: 'machine', listener: () => void): () => void }): CapabilitySource {
  return { read: () => localGitReads(hosts.peer('machine')), onChange: (listener) => hosts.onState('machine', () => listener()) };
}

/**
 * One machine's capabilities from several sources (the project acts', the reads'): their lists joined, null only while
 * every source is unknown. A change is told by each source that hears it; the manager reads the whole list again at each.
 */
export function joinCapabilitySources(...sources: CapabilitySource[]): CapabilitySource {
  return {
    read() {
      const lists = sources.map((source) => source.read());
      return lists.every((list) => list === null) ? null : lists.flatMap((list) => list ?? []);
    },
    onChange(listener) {
      const offs = sources.map((source) => source.onChange(listener));
      return () => {
        for (const off of offs) off();
      };
    },
  };
}
