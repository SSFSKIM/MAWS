// Review's data (C8c execution document, Interfaces *Review's data*): the patches of the git scopes, one read per
// (directory, scope, read) however many surfaces hold it (the panel's Review and a diff tab over the same scope share it),
// re-read 250 ms after the last new status C8a's git store takes for the directory (its `git.changed`), one read in
// flight per key; a scope past REVIEW_SCOPE_BYTES_CAP keeps its file list and fetches one file at a time. Last turn
// reads no git: its files come from the transcript store. The held scopes are kept in ./held-diffs (P4 W2-B).
//
// UX wave U5b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, §E and §G): which read a scope
// takes. Where the machine serves the reads (`servesReads`), Uncommitted is the working tree against HEAD and This branch
// the working tree against the merge base with the default branch (`git.changesSince`, the new files counted; the base
// from the branch read, ./branch-read), and a commit is its own diff (`git.commitDiff`), kept once read; elsewhere
// Uncommitted is `git.diff` as before and This branch is off. A target's key holds its read and what it is against, so a
// merge base that moves, or a machine found to serve the reads, is a new target and the scope is read again.
//
// The status and the watch that keeps it current are C8a's `useGit`; the surfaces hold its watch while mounted.
import { useEffect, useMemo, useRef } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { type MawsBridge } from '@shared/ipc/schema';
import type { GitCommit, GitDiffInput, GitStatus } from '@shared/ipc/schema/git';
import type { MachineRef } from '@shared/machine/ref';
import { useMachineMark } from '../../../app/machine-mark';
import { ipc } from '../../../ipc/client';
import { checkoutKey, machineFor, pathTarget } from '../../../ipc/machine';
import { useGit } from '../../../stores/git';
import { useTranscriptStore, type TurnActivity, type TurnId } from '../../../transcript';
import { REVIEW_COPY } from '../copy';
import { branchReadOf, useBranchReads } from './branch-read';
import { createHeldDiffs, diffKeys, followGitStatus, HELD_DIFF_REFRESH_MS, mapWith, mapWithout, settled, type DiffRead, type FileDiff, type ScopeDiff } from './held-diffs';
import { readFailure, useServesReads, type ReadError } from './reads';
import { gitScopeFiles, indexDiffers, dividerOf, turnScopeFiles, type ReviewFile, type ReviewScope } from './review-model';

export type { FileDiff, ScopeDiff } from './held-diffs';

export const REVIEW_REFRESH_MS = HELD_DIFF_REFRESH_MS;

export type GitScope = Exclude<ReviewScope, 'turn'>;
// UX wave U5b-2 (§E): the command a scope is read with
export type ScopeRead = 'git.diff' | 'git.changesSince' | 'git.commitDiff';
export interface DiffTarget {
  machine: MachineRef; // P5 O6 M4: the directory's, its session's machine
  directory: string;
  scope: GitScope;
  read: ScopeRead; // UX wave U5b-2: `git.diff` (Staged; Uncommitted where the reads are not served), the working-tree read, a commit's diff
  against: string | null; // the working-tree read's `against` (`HEAD`, or This branch's merge base), a commit's diff's commit; null for `git.diff`
  session?: AppSessionId; // P5 O7 M4: the session the scope is read for, named on its reads (not part of its key)
}

export interface ReviewStore {
  diffs: ReadonlyMap<string, ScopeDiff>; // by diffKey
  files: ReadonlyMap<string, FileDiff>; // by fileKey: one file of a scope past its cap
  onHead: ReadonlyMap<string, boolean>; // UX wave U5b-2: by a commit's diffKey, HEAD's membership as the last check answered
  hold(target: DiffTarget): () => void; // ref-counted; the first reads, the last forgets
  refresh(target: DiffTarget): void; // re-read now (the tool shown again, a focus request); a kept commit's only when it failed
  statusChanged(checkout: string): void; // a new status for the git store's checkout: every held scope of it re-reads, trailing; never a commit's
  loadFile(target: DiffTarget, path: string, untracked?: boolean): void; // P5 O7 M8: `untracked`, a file the status lists untracked
  retryFile(target: DiffTarget, path: string, untracked?: boolean): void; // UX wave U5b: Retry, a file's own read that failed
  retryFailed(target: DiffTarget): void; // UX wave U5b-2 (§G): the target's read, or its files' own reads, that failed
  checkMembership(target: DiffTarget): void; // UX wave U5b-2 (§G): a commit's `onHead` asked again, with `patch: false`
  reset(): void; // tests
}

const keys = diffKeys<DiffTarget>((t) => `${checkoutKey(t.machine, t.directory)}\0${t.scope}\0${t.read}\0${t.against ?? ''}`, '\0');

export const diffOf = (s: Pick<ReviewStore, 'diffs'>, t: DiffTarget) => s.diffs.get(keys.diff(t));
export const fileDiffOf = (s: Pick<ReviewStore, 'files'>, t: DiffTarget, path: string) => s.files.get(keys.file(t, path));
export const onHeadOf = (s: Pick<ReviewStore, 'onHead'>, t: DiffTarget) => s.onHead.get(keys.diff(t));

const diffInput = (t: DiffTarget, path?: string): GitDiffInput => ({
  directory: t.directory,
  scope: t.scope === 'staged' ? 'staged' : 'all',
  ...(path !== undefined ? { path } : {}),
});

// The read a target, or one file of it, is made with (§E's table).
function readOf(t: DiffTarget, path?: string): DiffRead {
  const one = path !== undefined ? { path } : {};
  if (t.read === 'git.changesSince') return { name: 'git.changesSince', input: { directory: t.directory, against: t.against ?? 'HEAD', ...one } };
  if (t.read === 'git.commitDiff' && t.against !== null) return { name: 'git.commitDiff', input: { directory: t.directory, commit: t.against, ...one } };
  return { name: 'git.diff', input: diffInput(t, path) };
}

export function createReviewStore(
  client: MawsBridge,
  options: { git?: typeof useGit } = {},
): UseBoundStore<StoreApi<ReviewStore>> {
  const store = create<ReviewStore>()((set, get) => {
    // a commit's diff is kept (decision 17): read once, and asked again only where it failed
    const heldDiffs = createHeldDiffs(client, set, { keys, input: diffInput, read: readOf, kept: (t) => t.read === 'git.commitDiff' });
    const checking = new Map<string, { again: boolean }>(); // a membership check in flight, by the commit's diffKey
    // M9 fix 2 (Decision Log 38, 2): a commit's membership belongs to the holds that asked it: the last release forgets it
    // and drops a check still out, as it forgets the diff, so the next full read's `onHead` stands until HEAD moves again
    const commitHolds = new Map<string, number>();

    const check = async (target: DiffTarget): Promise<void> => {
      const key = keys.diff(target);
      const inFlight = checking.get(key);
      if (inFlight) {
        inFlight.again = true;
        return;
      }
      const mine = { again: false };
      checking.set(key, mine);
      const result = await settled(client.invoke('git.commitDiff', { directory: target.directory, commit: target.against!, patch: false }, pathTarget(target.machine, target.session)));
      if (checking.get(key) !== mine) return; // reset meanwhile
      checking.delete(key);
      if (result.ok) set((s) => ({ onHead: mapWith(s.onHead, key, result.value.onHead) }));
      if (mine.again) void check(target);
    };

    return {
      diffs: new Map(),
      files: new Map(),
      onHead: new Map(),

      hold(target) {
        const release = heldDiffs.hold(target);
        if (target.read !== 'git.commitDiff') return release;
        const key = keys.diff(target);
        commitHolds.set(key, (commitHolds.get(key) ?? 0) + 1);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          release();
          const left = (commitHolds.get(key) ?? 1) - 1;
          if (left > 0) return void commitHolds.set(key, left);
          commitHolds.delete(key);
          checking.delete(key); // its answer, when it comes, is dropped
          if (get().onHead.has(key)) set((s) => ({ onHead: mapWithout(s.onHead, (k) => k === key) }));
        };
      },
      refresh: heldDiffs.refresh,

      statusChanged(checkout) {
        heldDiffs.reread((t) => checkoutKey(t.machine, t.directory) === checkout);
      },

      // P5 O7 M8 ("Untracked files"): an untracked file is no scope's diff; it is read as Source control reads it, the
      // `untracked` scope (the file against /dev/null, as `git add` would stage it), so it shows as added
      loadFile(target, path, untracked = false) {
        heldDiffs.loadFile(target, path, untracked ? { directory: target.directory, scope: 'untracked', path } : undefined);
      },

      // UX wave U5b (§F, the bodies): Retry in a file's row asks its own read again; a read in flight or answered is left
      retryFile(target, path, untracked = false) {
        if (fileDiffOf(get(), target, path)?.status !== 'error') return;
        heldDiffs.reloadFile(target, path, untracked ? { directory: target.directory, scope: 'untracked', path } : undefined);
      },

      retryFailed: heldDiffs.retryFailed,

      checkMembership(target) {
        if (target.read === 'git.commitDiff' && target.against !== null) void check(target);
      },

      reset() {
        heldDiffs.clear();
        checking.clear();
        commitHolds.clear();
        set({ diffs: new Map(), files: new Map(), onHead: new Map() });
      },
    };
  });

  // A new status C8a's store took for a directory re-reads the scopes held over that directory.
  if (options.git) followGitStatus(options.git, (checkout) => store.getState().statusChanged(checkout));
  return store;
}

export const useReview = createReviewStore(ipc, { git: useGit });

// ---- what a Review surface shows for a session's directory and a scope ----------------------------------------------

const NOT_A_REPOSITORY = 'not a git repository'; // C4's message (src/services/git/runner.ts), as C8a's Environment reads it

// Settled: known, available with its base and merge base, or unavailable with the reason (the disabled chip's tooltip). UX
// wave U5b-2: from the branch read, where the machine serves it. A branch read that failed before it ever answered leaves
// the chip enabled, its `failure` said in the scope's body with Retry (M9 fix 2, Decision Log 38); with an answer kept, a
// later failure changes nothing (§E).
export type BranchAvailability =
  | { settled: false; base: null; mergeBase: null; reason: null; failure: null }
  | { settled: true; base: string; mergeBase: string; reason: null; failure: null }
  | { settled: true; base: null; mergeBase: null; reason: string; failure: null }
  | { settled: true; base: null; mergeBase: null; reason: null; failure: ReadError };

export type ReviewList =
  | { phase: 'pending' }
  | { phase: 'unavailable'; message: string; retry?: () => void } // the whole sentence the body shows; UX wave U5b-2: with Retry, what it asks again (a commit's diff, a failed first branch read)
  | { phase: 'ready'; files: ReviewFile[] };

// UX wave U5b-2 (§E, §G): the commit a chip is listed for, as its kept read answered (null until it did)
export interface ReviewCommit {
  target: DiffTarget | null; // held while the chip is listed, whichever scope is shown; null where the reads are not served
  commit: GitCommit | null;
  onHead: boolean | null; // HEAD holds it: the read's answer, then each membership check's
}

export interface ReviewData {
  status: GitStatus | null;
  gitFailed: boolean; // no status because the watch failed (not a repository, git unavailable)
  servesReads: boolean | null; // UX wave U5b-2: the session's machine serves the three reads (`servesReads`)
  machine: string | null; // UX wave U5b-2: the machine's name in words, null for this Mac
  branch: BranchAvailability;
  staged: boolean; // the index differs from HEAD
  target: DiffTarget | null; // the git scope held, for a file fetched past the cap and a refresh
  commit: ReviewCommit;
  pastCap: boolean; // the scope's patch is past REVIEW_SCOPE_BYTES_CAP: its files open folded and each is read on its own
  list: ReviewList;
}

type TranscriptEntries = ReturnType<typeof useTranscriptStore.getState>['entries'];

// The transcript store key holding a turn of the session: its own key, or a child agent's (`<appSessionId>:<agentId>`).
export function turnKeyOf(entries: TranscriptEntries, appSessionId: AppSessionId, turnId: TurnId): string | null {
  for (const key of Object.keys(entries)) {
    if (key !== appSessionId && !key.startsWith(`${appSessionId}:`)) continue;
    if (entries[key].state.turns.has(turnId)) return key;
  }
  return null;
}

// "This branch" (§E): off where the machine does not serve the reads; not settled while that is unknown, or while the
// branch read has not answered; with no default branch, off with its reason.
function branchOf(status: GitStatus | null, serves: boolean | null, read: ReturnType<typeof branchReadOf>, machine: string | null): BranchAvailability {
  const unsettled = { settled: false, base: null, mergeBase: null, reason: null, failure: null } as const;
  if (!status || serves === null) return unsettled;
  if (!serves) return { settled: true, base: null, mergeBase: null, reason: REVIEW_COPY.branchNeedsReads(machine), failure: null };
  if (!read || (read.answer === null && read.failure === null)) return unsettled;
  if (read.answer === null) return { settled: true, base: null, mergeBase: null, reason: null, failure: read.failure! };
  const base = read.answer.base;
  return base === null
    ? { settled: true, base: null, mergeBase: null, reason: REVIEW_COPY.noDefaultBranch, failure: null }
    : { settled: true, base: base.ref, mergeBase: base.mergeBase, reason: null, failure: null };
}

// Holds C8a's git watch on the directory, the branch read while in view, and the scope's read (and a listed commit's) while
// mounted; Last turn reads the transcript store.
export function useReviewData(input: { appSessionId: AppSessionId; directory: string; scope: ReviewScope | null; turnId: TurnId | null; commit?: string | null; visible?: boolean }): ReviewData {
  const { appSessionId, directory, scope, turnId, commit = null, visible = true } = input;
  const machine = machineFor(appSessionId);
  const mark = useMachineMark(appSessionId);
  const machineWords = mark.local ? null : mark.name;
  const serves = useServesReads(machine);
  const entry = useGit((s) => s.entries.get(checkoutKey(machine, directory)));
  const status = entry?.status ?? null;
  const gitError = entry?.error ?? null;
  const repoRoot = status?.repoRoot ?? null;
  const read = useBranchReads((s) => (repoRoot !== null ? branchReadOf(s, machine, repoRoot) : undefined));
  const branch = useMemo(() => branchOf(status, serves, read, machineWords), [status, serves, read, machineWords]);

  useEffect(() => useGit.getState().watch(machine, directory, appSessionId), [machine, directory, appSessionId]); // P5 O7 M4: made from the session
  // UX wave U5b-2 (§E): the branch read is held while the surface is in view, and only where the machine serves it
  useEffect(() => {
    if (serves !== true || repoRoot === null || !visible) return;
    return useBranchReads.getState().hold({ machine, repoRoot, directory, session: appSessionId });
  }, [serves, repoRoot, visible, machine, directory, appSessionId]);

  const known = status !== null;
  const mergeBase = branch.mergeBase;
  const target = useMemo<DiffTarget | null>(() => {
    if (!known || scope === null || scope === 'turn') return null;
    const of = (read: ScopeRead, against: string | null): DiffTarget => ({ machine, directory, scope, read, against, session: appSessionId });
    if (scope === 'branch') return mergeBase === null ? null : of('git.changesSince', mergeBase);
    if (scope === 'commit') return serves === true && commit !== null ? of('git.commitDiff', commit) : null;
    if (scope === 'uncommitted' && serves === true) return of('git.changesSince', 'HEAD');
    return of('git.diff', null);
  }, [known, scope, machine, directory, mergeBase, serves, commit, appSessionId]);
  useEffect(() => (target ? useReview.getState().hold(target) : undefined), [target]);
  const diff = useReview((s) => (target ? diffOf(s, target) : undefined));

  // UX wave U5b-2 (§G): a listed commit's diff is held while its chip is, whichever scope is shown, so choosing it again
  // reads nothing; when HEAD moves, one membership check is asked for it
  const commitTarget = useMemo<DiffTarget | null>(
    () => (known && serves === true && commit !== null ? { machine, directory, scope: 'commit', read: 'git.commitDiff', against: commit, session: appSessionId } : null),
    [known, serves, commit, machine, directory, appSessionId],
  );
  useEffect(() => (commitTarget ? useReview.getState().hold(commitTarget) : undefined), [commitTarget]);
  const commitDiff = useReview((s) => (commitTarget ? diffOf(s, commitTarget) : undefined));
  const checkedOnHead = useReview((s) => (commitTarget ? onHeadOf(s, commitTarget) : undefined));
  const head = status?.head ?? null;
  const headSeen = useRef<{ target: DiffTarget | null; head: string | null }>({ target: null, head: null });
  useEffect(() => {
    const seen = headSeen.current;
    headSeen.current = { target: commitTarget, head };
    if (commitTarget !== null && seen.target === commitTarget && head !== null && seen.head !== null && head !== seen.head) useReview.getState().checkMembership(commitTarget);
  }, [commitTarget, head]);
  const commitInfo = useMemo<ReviewCommit>(() => {
    const answered = commitDiff?.status === 'ok' ? (commitDiff.commit ?? null) : null;
    return { target: commitTarget, commit: answered?.commit ?? null, onHead: checkedOnHead ?? answered?.onHead ?? null };
  }, [commitTarget, commitDiff, checkedOnHead]);

  // Last turn: the store key holding the turn, then the turn's activity entry, which C6 keeps while the turn is
  // unchanged, so another turn streaming recomputes nothing here; the divider is read with it.
  const turnKey = useTranscriptStore((s) => (scope === 'turn' && turnId !== null ? turnKeyOf(s.entries, appSessionId, turnId) : null));
  const activity = useTranscriptStore((s): TurnActivity | null => (turnKey !== null ? (s.activity(turnKey).find((a) => a.turnId === turnId) ?? null) : null));
  const turn = useMemo(() => {
    if (turnKey === null || turnId === null) return null;
    const entry = useTranscriptStore.getState().entries[turnKey];
    return entry ? { divider: dividerOf(entry.rows, turnId), activity } : null;
  }, [turnKey, turnId, activity]);

  const offline = mark.offline;
  const list = useMemo<ReviewList>(() => {
    if (scope === null) return { phase: 'pending' };
    if (scope === 'turn') {
      if (!turn) return { phase: 'unavailable', message: REVIEW_COPY.unavailable(REVIEW_COPY.turnNotLoaded) };
      return { phase: 'ready', files: turnScopeFiles(turn.divider?.files ?? [], turn.activity, status?.repoRoot ?? null) };
    }
    if (!status) {
      if (gitError === NOT_A_REPOSITORY) return { phase: 'unavailable', message: REVIEW_COPY.notRepository };
      if (gitError) return { phase: 'unavailable', message: REVIEW_COPY.unavailable(gitError) };
      return { phase: 'pending' };
    }
    // This branch off says why; a branch read that failed before it ever answered says its failure in §H's words for the
    // kind, with Retry asking the branch read again and nothing else (M9 fix 2, Decision Log 38)
    if (scope === 'branch' && branch.settled && branch.base === null) {
      if (branch.failure === null) return { phase: 'unavailable', message: branch.reason };
      const failed = commitFailure(branch.failure, offline, machineWords, mark.name);
      return { phase: 'unavailable', message: failed.message, ...(failed.retry && repoRoot !== null && { retry: () => useBranchReads.getState().retry(machine, repoRoot) }) };
    }
    // a commit where the machine does not serve the reads (§E's last column; S20): nothing is asked
    if (scope === 'commit' && serves === false) return { phase: 'unavailable', message: REVIEW_COPY.commitNeedsReads(machineWords) };
    if (!diff || diff.status === 'loading') return { phase: 'pending' };
    if (diff.status === 'error') {
      if (scope !== 'commit') return { phase: 'unavailable', message: REVIEW_COPY.unavailable(diff.message) };
      const failed = commitFailure(diff, offline, machineWords, mark.name);
      return { phase: 'unavailable', message: failed.message, ...(failed.retry && target !== null && { retry: () => useReview.getState().retryFailed(target) }) };
    }
    return { phase: 'ready', files: gitScopeFiles({ scope, repoRoot: status.repoRoot, files: diff.files, patch: diff.patch, status, untracked: diff.untracked ?? null }) };
  }, [scope, turn, status, gitError, branch, serves, diff, offline, machineWords, mark.name, machine, repoRoot, target]);

  const pastCap = diff?.status === 'ok' && diff.patch === null;
  return { status, gitFailed: status === null && gitError !== null, servesReads: serves, machine: machineWords, branch, staged: indexDiffers(status), target, commit: commitInfo, pastCap, list };
}

// §H's refusals told apart, for a commit's diff in Review, the scope's read or one file's: the sentence, and whether Retry
// stands beside it (an older machine's has none: nothing more is asked there). `machine` is the name in words, null for
// this Mac; `name` the machine's name for the other sentences.
export function commitFailure(error: ReadError, offline: boolean, machine: string | null, name: string): { message: string; retry: boolean } {
  const failure = readFailure(error, offline);
  switch (failure.kind) {
    case 'older':
      return { message: REVIEW_COPY.commitNeedsReads(machine), retry: false };
    case 'offline':
      return { message: REVIEW_COPY.commitOffline(name), retry: true };
    case 'refused':
      return { message: REVIEW_COPY.commitRefused(name), retry: true };
    case 'failed':
      return { message: REVIEW_COPY.unavailable(failure.message), retry: true };
  }
}
