// Review's data (C8c execution document, Interfaces *Review's data*): the patches of the git scopes, one `git.diff` per
// (directory, scope) however many surfaces hold it (the panel's Review and a diff tab over the same scope share it),
// re-read 250 ms after the last new status C8a's git store takes for the directory (its `git.changed`), one read in
// flight per key; a scope past REVIEW_SCOPE_BYTES_CAP keeps its file list and fetches one file at a time; and This
// branch's base from C10's `git.worktree.branch`. Last turn reads no git: its files come from the transcript store.
// The held scopes are the cache Source control's store shares (./held-diffs, P4 W2-B).
//
// The status and the watch that keeps it current are C8a's `useGit`; the surfaces hold its watch while mounted.
import { useEffect, useMemo } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { type MawsBridge } from '@shared/ipc/schema';
import type { GitStatus } from '@shared/ipc/schema/git';
import { ipc } from '../../../ipc/client';
import { useGit } from '../../../stores/git';
import { useTranscriptStore, type TurnActivity, type TurnId } from '../../../transcript';
import { REVIEW_COPY } from '../copy';
import { createHeldDiffs, diffKeys, followGitStatus, HELD_DIFF_REFRESH_MS, mapWith, settled, type FileDiff, type ScopeDiff } from './held-diffs';
import { gitScopeFiles, indexDiffers, dividerOf, turnScopeFiles, type ReviewFile, type ReviewScope } from './review-model';

export type { FileDiff, ScopeDiff } from './held-diffs';

export const REVIEW_REFRESH_MS = HELD_DIFF_REFRESH_MS;

export type GitScope = Exclude<ReviewScope, 'turn'>;
export interface DiffTarget {
  directory: string;
  scope: GitScope;
  base: string | null; // This branch's base; null for the other scopes
}

// `failed`: the call itself failed; not kept, so the next lookup asks again.
export type BaseLookup = { status: 'loading' } | { status: 'ok'; base: string } | { status: 'unavailable'; reason: string; failed?: true };

export interface ReviewStore {
  diffs: ReadonlyMap<string, ScopeDiff>; // by diffKey
  files: ReadonlyMap<string, FileDiff>; // by fileKey: one file of a scope past its cap
  bases: ReadonlyMap<string, BaseLookup>; // by `${repoRoot}\0${branch}`
  hold(target: DiffTarget): () => void; // ref-counted; the first reads, the last forgets
  refresh(target: DiffTarget): void; // re-read now (the tool shown again, a focus request)
  statusChanged(directory: string): void; // a new status for the directory: every held scope of it re-reads, trailing
  loadFile(target: DiffTarget, path: string): void;
  lookupBase(repoRoot: string, branch: string): void;
  reset(): void; // tests
}

const keys = diffKeys<DiffTarget>((t) => `${t.directory}\0${t.scope}\0${t.base ?? ''}`, '\0');
const baseKey = (repoRoot: string, branch: string) => `${repoRoot}\0${branch}`;

export const diffOf = (s: Pick<ReviewStore, 'diffs'>, t: DiffTarget) => s.diffs.get(keys.diff(t));
export const fileDiffOf = (s: Pick<ReviewStore, 'files'>, t: DiffTarget, path: string) => s.files.get(keys.file(t, path));
export const baseOf = (s: Pick<ReviewStore, 'bases'>, repoRoot: string, branch: string) => s.bases.get(baseKey(repoRoot, branch));

const diffInput = (t: DiffTarget, path?: string) => ({
  directory: t.directory,
  scope: t.scope === 'staged' ? ('staged' as const) : ('all' as const),
  ...(t.base !== null ? { base: t.base } : {}),
  ...(path !== undefined ? { path } : {}),
});

export function createReviewStore(
  client: MawsBridge,
  options: { git?: typeof useGit } = {},
): UseBoundStore<StoreApi<ReviewStore>> {
  const store = create<ReviewStore>()((set, get) => {
    const heldDiffs = createHeldDiffs(client, set, { keys, input: diffInput });

    return {
      diffs: new Map(),
      files: new Map(),
      bases: new Map(),

      hold: heldDiffs.hold,
      refresh: heldDiffs.refresh,

      statusChanged(directory) {
        heldDiffs.reread((t) => t.directory === directory);
      },

      loadFile: heldDiffs.loadFile,

      lookupBase(repoRoot, branch) {
        const key = baseKey(repoRoot, branch);
        const known = get().bases.get(key);
        if (known && !(known.status === 'unavailable' && known.failed)) return;
        set((s) => ({ bases: mapWith(s.bases, key, { status: 'loading' }) }));
        // C10's answer: null when `refs/heads/<branch>` does not resolve, which for the branch HEAD names means it has no
        // commits yet; `base` is the main worktree's branch, `HEAD` when that is detached.
        void settled(client.invoke('git.worktree.branch', { repoRoot, branch })).then((result) => {
          const next: BaseLookup = !result.ok
            ? { status: 'unavailable', reason: result.error.message, failed: true }
            : result.value === null
              ? { status: 'unavailable', reason: REVIEW_COPY.noCommits(branch) }
              : result.value.base === 'HEAD'
                ? { status: 'unavailable', reason: REVIEW_COPY.noMainBranch }
                : result.value.base === branch
                  ? { status: 'unavailable', reason: REVIEW_COPY.mainWorktreeBranch(branch) }
                  : { status: 'ok', base: result.value.base };
          set((s) => ({ bases: mapWith(s.bases, key, next) }));
        });
      },

      reset() {
        heldDiffs.clear();
        set({ diffs: new Map(), files: new Map(), bases: new Map() });
      },
    };
  });

  // A new status C8a's store took for a directory re-reads the scopes held over that directory.
  if (options.git) followGitStatus(options.git, (directory) => store.getState().statusChanged(directory));
  return store;
}

export const useReview = createReviewStore(ipc, { git: useGit });

// ---- what a Review surface shows for a session's directory and a scope ----------------------------------------------

const NOT_A_REPOSITORY = 'not a git repository'; // C4's message (src/main/git/runner.ts), as C8a's Environment reads it

// Settled: known, available with its base or unavailable with the reason (the disabled chip's tooltip).
export type BranchAvailability =
  | { settled: false; base: null; reason: null }
  | { settled: true; base: string; reason: null }
  | { settled: true; base: null; reason: string };

export type ReviewList =
  | { phase: 'pending' }
  | { phase: 'unavailable'; message: string } // the whole sentence the body shows
  | { phase: 'ready'; files: ReviewFile[] };

export interface ReviewData {
  status: GitStatus | null;
  gitFailed: boolean; // no status because the watch failed (not a repository, git unavailable)
  branch: BranchAvailability;
  staged: boolean; // the index differs from HEAD
  target: DiffTarget | null; // the git scope held, for a file fetched past the cap and a refresh
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

function branchOf(status: GitStatus | null, lookup: BaseLookup | undefined): BranchAvailability {
  if (!status) return { settled: false, base: null, reason: null };
  if (status.branch === null) return { settled: true, base: null, reason: REVIEW_COPY.detachedHead };
  if (!lookup || lookup.status === 'loading') return { settled: false, base: null, reason: null };
  return lookup.status === 'ok' ? { settled: true, base: lookup.base, reason: null } : { settled: true, base: null, reason: lookup.reason };
}

// Holds C8a's git watch on the directory and the scope's diff while mounted; Last turn reads the transcript store.
export function useReviewData(input: { appSessionId: AppSessionId; directory: string; scope: ReviewScope | null; turnId: TurnId | null }): ReviewData {
  const { appSessionId, directory, scope, turnId } = input;
  const entry = useGit((s) => s.entries.get(directory));
  const status = entry?.status ?? null;
  const gitError = entry?.error ?? null;
  const repoRoot = status?.repoRoot ?? null;
  const branchName = status?.branch ?? null;
  const lookup = useReview((s) => (repoRoot !== null && branchName !== null ? baseOf(s, repoRoot, branchName) : undefined));
  const branch = useMemo(() => branchOf(status, lookup), [status, lookup]);

  useEffect(() => useGit.getState().watch(directory), [directory]);
  useEffect(() => {
    if (repoRoot !== null && branchName !== null) useReview.getState().lookupBase(repoRoot, branchName);
  }, [repoRoot, branchName]);

  const known = status !== null;
  const base = branch.base;
  const target = useMemo<DiffTarget | null>(() => {
    if (!known || scope === null || scope === 'turn') return null;
    if (scope === 'branch') return base === null ? null : { directory, scope, base };
    return { directory, scope, base: null };
  }, [known, scope, directory, base]);
  useEffect(() => (target ? useReview.getState().hold(target) : undefined), [target]);
  const diff = useReview((s) => (target ? diffOf(s, target) : undefined));

  // Last turn: the store key holding the turn, then the turn's activity entry, which C6 keeps while the turn is
  // unchanged, so another turn streaming recomputes nothing here; the divider is read with it.
  const turnKey = useTranscriptStore((s) => (scope === 'turn' && turnId !== null ? turnKeyOf(s.entries, appSessionId, turnId) : null));
  const activity = useTranscriptStore((s): TurnActivity | null => (turnKey !== null ? (s.activity(turnKey).find((a) => a.turnId === turnId) ?? null) : null));
  const turn = useMemo(() => {
    if (turnKey === null || turnId === null) return null;
    const entry = useTranscriptStore.getState().entries[turnKey];
    return entry ? { divider: dividerOf(entry.rows, turnId), activity } : null;
  }, [turnKey, turnId, activity]);

  const list = useMemo<ReviewList>(() => {
    if (scope === null) return { phase: 'pending' };
    if (scope === 'turn') {
      if (!turn) return { phase: 'unavailable', message: REVIEW_COPY.unavailable(REVIEW_COPY.turnNotLoaded) };
      return { phase: 'ready', files: turnScopeFiles(turn.divider?.files ?? [], turn.activity) };
    }
    if (!status) {
      if (gitError === NOT_A_REPOSITORY) return { phase: 'unavailable', message: REVIEW_COPY.notRepository };
      if (gitError) return { phase: 'unavailable', message: REVIEW_COPY.unavailable(gitError) };
      return { phase: 'pending' };
    }
    if (scope === 'branch' && branch.settled && branch.base === null) return { phase: 'unavailable', message: branch.reason };
    if (!diff || diff.status === 'loading') return { phase: 'pending' };
    if (diff.status === 'error') return { phase: 'unavailable', message: REVIEW_COPY.unavailable(diff.message) };
    return { phase: 'ready', files: gitScopeFiles({ scope, repoRoot: status.repoRoot, files: diff.files, patch: diff.patch, status }) };
  }, [scope, turn, status, gitError, branch, diff]);

  return { status, gitFailed: status === null && gitError !== null, branch, staged: indexDiffers(status), target, list };
}
