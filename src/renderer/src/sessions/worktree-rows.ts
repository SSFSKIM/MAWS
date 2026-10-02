// The Worktrees… dialog's rows (C12 execution document, Interfaces "Worktrees dialog"; D4): what git lists for a
// repository, each checkout's state in C10's words, the sessions bound to it as main's occupancy names them (never path
// equality here), and whether a setup intent claims it. Pure, so the dialog renders what this answers.
import type { AppSessionId } from '@shared/graph/ids';
import type { SetupIntent } from '@shared/sessions/intent';
import { normalizePath } from '@shared/sessions/trust';
import type { WorktreeInfo, WorktreeStatus } from '@shared/sessions/worktree';

// An intent that may hold a checkout, and whether a start of it is in flight (C10's `isStarting`).
export interface Claim {
  intent: SetupIntent;
  starting: boolean;
}

export const CLAIM_WORDS = {
  settingUp: 'A session is being set up here',
  unstartedTab: 'An unstarted tab uses this checkout',
  kept: 'An unstarted session keeps this checkout',
} as const;

export interface WorktreeRow {
  info: WorktreeInfo;
  name: string;
  branchLabel: string;
  isMain: boolean;
  state: 'busy' | 'dirty' | 'clean' | 'missing';
  stateLabel: string;
  claim: string | null; // why a claimed checkout is busy
  sessionIds: AppSessionId[]; // the occupancy's live sessions, then its idle ones
  terminalSessions: number; // live holders outside MAWS: terminals and background jobs (foreign and unbound)
  noSession: boolean;
  removable: boolean; // offers Remove… (never the main checkout, never a claimed one)
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

// Why an intent holds `path`, or null. Both sides come from git's own listing (`git.worktree.list`, or the
// `git.worktree.add` answer an intent's progress records), so normalising is all the comparison needs.
export function claimOf(path: string, claims: readonly Claim[]): string | null {
  const here = normalizePath(path);
  const same = (p: string) => normalizePath(p) === here;
  const progressHere = (c: Claim) => c.intent.progress.worktree !== null && same(c.intent.progress.worktree.path);
  if (claims.some((c) => c.starting && progressHere(c))) return CLAIM_WORDS.settingUp;
  if (claims.some((c) => c.intent.location?.kind === 'existingWorktree' && same(c.intent.location.path))) return CLAIM_WORDS.unstartedTab;
  if (claims.some(progressHere)) return CLAIM_WORDS.kept;
  return null;
}

function stateOf(info: WorktreeInfo, status: WorktreeStatus | null): { state: WorktreeRow['state']; stateLabel: string } {
  if (status === null || info.prunable) return { state: 'missing', stateLabel: 'missing' };
  if (status.state === 'busy') {
    const live = status.occupancy.self + status.occupancy.foreign + status.occupancy.unbound;
    return { state: 'busy', stateLabel: live === 0 && status.locked ? 'busy · locked' : `busy · ${plural(live, 'session')} live here` };
  }
  if (status.state === 'dirty') return { state: 'dirty', stateLabel: `dirty · ${plural(status.dirty.tracked + status.dirty.untracked, 'change')}` };
  return { state: 'clean', stateLabel: 'clean' };
}

// The main checkout first, then each linked worktree in git's order. `statuses` holds `git.worktree.status` per listed
// path (null: git no longer lists it).
export function worktreeRows(worktrees: readonly WorktreeInfo[], statuses: ReadonlyMap<string, WorktreeStatus | null>, claims: readonly Claim[]): WorktreeRow[] {
  const ordered = [...worktrees.filter((w) => w.isMain), ...worktrees.filter((w) => !w.isMain)];
  return ordered.map((info) => {
    const status = statuses.get(info.path) ?? null;
    const claim = info.isMain ? null : claimOf(info.path, claims);
    const occupancy = status?.occupancy;
    const sessionIds = occupancy ? [...occupancy.liveAppSessionIds, ...occupancy.idleAppSessionIds] : [];
    const terminalSessions = occupancy ? occupancy.foreign + occupancy.unbound : 0;
    const { state, stateLabel } = claim !== null ? { state: 'busy' as const, stateLabel: 'busy' } : stateOf(info, status);
    return {
      info,
      name: basename(info.path),
      branchLabel: info.branch ?? 'detached',
      isMain: info.isMain,
      state,
      stateLabel,
      claim,
      sessionIds,
      terminalSessions,
      noSession: sessionIds.length === 0 && terminalSessions === 0 && (occupancy?.self ?? 0) === 0,
      removable: !info.isMain && claim === null,
    };
  });
}
