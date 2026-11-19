// Which daemons serve a side thread of several comments (UX wave U5a, docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md,
// Decision Log 52). The card sends a pass's later comments as `side.thread.open`'s `from.more`, which came at wire
// minor 43 (src/shared/ipc/wire.ts). The command is the machine's, and mawsd reads its input with the tolerant reader
// (`codec.readCommandInput`, src/mawsd/front.ts), so a daemon that predates `more` passes it by as a field it does not
// know and opens the thread from the first comment alone, and the card, told the send went, lets the whole pass go.
// This Mac's daemon may be of another build (`watchDaemon` leaves another bundle's daemon running), so such a send is
// refused before it goes, on the route (`refuseUnservedSideThreads`), in words the card shows, and the pass stays. The
// shape is the project acts' (./project-acts-peer.ts); a thread of one comment and a `/btw` promotion go as before.
import type { BeforeHook } from '../ipc/router';
import { ipcError } from '@shared/ipc/errors';
import type { CommandName } from '@shared/ipc/schema';
import type { WirePeer } from '@shared/ipc/wire';
import { THREAD_ABOUT_A_COMMIT, THREAD_FROM_ONE_COMMENT } from '@shared/side/copy';
import { GIT_READS_MINOR } from './git-reads-peer';

/** The wire minor whose `side.thread.open` carries a comment's `more`; provisional with the minor, re-taken at the chain merge. */
export const SIDE_THREAD_MORE_MINOR = 43;

/** The commands the route's hook reads. */
export const SIDE_THREAD_COMMANDS: readonly CommandName[] = ['side.thread.open'];

// A side thread opened from a comment with later ones (`more`), the one input an older daemon would take for another.
const carriesMore = (input: unknown): boolean => {
  const from = (input as { from?: { kind?: unknown; more?: unknown } } | undefined)?.from;
  return from?.kind === 'comment' && from.more !== undefined;
};

// UX wave U5b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, §K; decision 24): a comment on a
// commit's diff, the first or a later one, whose anchor names the commit; a daemon older than the reads (GIT_READS_MINOR)
// would drop the key and write a first message that names no commit.
const carriesCommit = (input: unknown): boolean => {
  const from = (input as { from?: { kind?: unknown; anchor?: { commit?: unknown }; more?: unknown } } | undefined)?.from;
  if (from?.kind !== 'comment') return false;
  const more = Array.isArray(from.more) ? (from.more as { anchor?: { commit?: unknown } }[]) : [];
  return [from, ...more].some((comment) => comment?.anchor?.commit !== undefined);
};

/**
 * The host route's hook: a side thread the attached daemon would open from something else (one comment of several, or a
 * comment that no longer names its commit) is refused, the refusal's message the card's words; while no daemon is
 * welcomed it is `host_unavailable`, as the project acts' hook answers, since the supervisor would hold it for whichever
 * daemon welcomes next. Anything else goes on.
 */
export function refuseUnservedSideThreads(peer: () => Pick<WirePeer, 'minor'> | null, machineName: string): BeforeHook {
  return async (name, input) => {
    if (name !== 'side.thread.open') return undefined;
    const more = carriesMore(input);
    const commit = carriesCommit(input);
    if (!more && !commit) return undefined;
    const daemon = peer();
    if (daemon === null) return { ok: false, error: ipcError('host_unavailable', `${name}: ${machineName}'s daemon is not connected now`) };
    if (more && daemon.minor < SIDE_THREAD_MORE_MINOR) return { ok: false, error: ipcError('internal', THREAD_FROM_ONE_COMMENT, { refusal: 'not-offered' }) };
    if (commit && daemon.minor < GIT_READS_MINOR) return { ok: false, error: ipcError('internal', THREAD_ABOUT_A_COMMIT, { refusal: 'not-offered' }) };
    return undefined;
  };
}
