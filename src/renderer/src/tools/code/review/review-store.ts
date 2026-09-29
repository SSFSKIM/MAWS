// Review's data (C8c execution document, Interfaces *Review's data*): the patches of the git scopes, one `git.diff` per
// (directory, scope) however many surfaces hold it (the panel's Review and a diff tab over the same scope share it),
// re-read 250 ms after the last new status C8a's git store takes for the directory (its `git.changed`), one read in
// flight per key; a scope past REVIEW_SCOPE_BYTES_CAP keeps its file list and fetches one file at a time; and This
// branch's base from C10's `git.worktree.branch`, looked up only once that command is in the X2 registry, so its
// arrival lights the chip without a change here. Last turn reads no git: its files come from the transcript store.
//
// The status and the watch that keeps it current are C8a's `useGit`; the surfaces hold its watch while mounted.
import { useEffect, useMemo } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import { commands, type CommandName, type CommandResult, type MawsBridge } from '@shared/ipc/schema';
import type { GitDiff, GitDiffFile, GitStatus } from '@shared/ipc/schema/git';
import { ipc } from '../../../ipc/client';
import { useGit } from '../../../stores/git';
import { useTranscriptStore, type TurnActivity, type TurnId } from '../../../transcript';
import { REVIEW_COPY } from '../copy';
import {
  gitScopeFiles,
  indexDiffers,
  receiptOf,
  REVIEW_SCOPE_BYTES_CAP,
  splitPatch,
  turnScopeFiles,
  type PatchFile,
  type ReviewFile,
  type ReviewScope,
} from './review-model';

export const REVIEW_REFRESH_MS = 250; // trailing, like C8a's GIT_DIFF_DELAY_MS

// C10's command, not on master when C8c landed (charter C10): typed here as its document defines it.
export const BRANCH_COMMAND = 'git.worktree.branch';
export const branchCommandRegistered = (): boolean => BRANCH_COMMAND in commands;

export type GitScope = Exclude<ReviewScope, 'turn'>;
export interface DiffTarget {
  directory: string;
  scope: GitScope;
  base: string | null; // This branch's base; null for the other scopes
}

export type ScopeDiff =
  | { status: 'loading' }
  | { status: 'ok'; files: GitDiffFile[]; patch: ReadonlyMap<string, PatchFile> | null } // patch null past the scope cap
  | { status: 'error'; message: string };
export type FileDiff = { status: 'loading' } | { status: 'ok'; file: PatchFile | null } | { status: 'error'; message: string };
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

const diffKey = (t: DiffTarget) => `${t.directory}\0${t.scope}\0${t.base ?? ''}`;
const fileKey = (t: DiffTarget, path: string) => `${diffKey(t)}\0${path}`;
const baseKey = (repoRoot: string, branch: string) => `${repoRoot}\0${branch}`;

export const diffOf = (s: Pick<ReviewStore, 'diffs'>, t: DiffTarget) => s.diffs.get(diffKey(t));
export const fileDiffOf = (s: Pick<ReviewStore, 'files'>, t: DiffTarget, path: string) => s.files.get(fileKey(t, path));
export const baseOf = (s: Pick<ReviewStore, 'bases'>, repoRoot: string, branch: string) => s.bases.get(baseKey(repoRoot, branch));

const diffInput = (t: DiffTarget, path?: string) => ({
  directory: t.directory,
  scope: t.scope === 'staged' ? ('staged' as const) : ('all' as const),
  ...(t.base !== null ? { base: t.base } : {}),
  ...(path !== undefined ? { path } : {}),
});

// A bridge that throws (not a command's failure answer) is a failure too, so nothing stays in flight.
async function settled<N extends CommandName>(call: Promise<CommandResult<N>>): Promise<CommandResult<N>> {
  try {
    return await call;
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
  }
}

interface Held {
  target: DiffTarget;
  count: number;
  timer: ReturnType<typeof setTimeout> | null;
  reading: boolean;
  again: boolean;
}

function mapWith<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> {
  return new Map(map).set(key, value);
}
function mapWithout<K, V>(map: ReadonlyMap<K, V>, drop: (key: K) => boolean): Map<K, V> {
  return new Map([...map].filter(([key]) => !drop(key)));
}

export function createReviewStore(
  client: MawsBridge,
  options: { branchCommand?: boolean; git?: typeof useGit } = {},
): UseBoundStore<StoreApi<ReviewStore>> {
  const branchCommand = options.branchCommand ?? branchCommandRegistered();
  const held = new Map<string, Held>();
  const fileLoads = new Set<string>();

  const store = create<ReviewStore>()((set, get) => {
    const read = async (key: string) => {
      const h = held.get(key);
      if (!h) return;
      if (h.reading) {
        h.again = true;
        return;
      }
      h.reading = true;
      const result = await settled(client.invoke('git.diff', diffInput(h.target)));
      h.reading = false;
      if (held.get(key) !== h) return; // released meanwhile
      const next: ScopeDiff = result.ok ? answered(result.value) : { status: 'error', message: result.error.message };
      set((s) => ({ diffs: mapWith(s.diffs, key, next), files: mapWithout(s.files, (k) => k.startsWith(`${key}\0`)) }));
      for (const k of [...fileLoads]) if (k.startsWith(`${key}\0`)) fileLoads.delete(k);
      if (h.again) {
        h.again = false;
        void read(key);
      }
    };

    const schedule = (h: Held, key: string) => {
      if (h.timer !== null) clearTimeout(h.timer);
      h.timer = setTimeout(() => {
        h.timer = null;
        void read(key);
      }, REVIEW_REFRESH_MS);
    };

    return {
      diffs: new Map(),
      files: new Map(),
      bases: new Map(),

      hold(target) {
        const key = diffKey(target);
        let h = held.get(key);
        if (h) h.count += 1;
        else {
          h = { target, count: 1, timer: null, reading: false, again: false };
          held.set(key, h);
          set((s) => ({ diffs: mapWith(s.diffs, key, { status: 'loading' }) }));
          void read(key);
        }
        const mine = h;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          if (--mine.count > 0) return;
          if (mine.timer !== null) clearTimeout(mine.timer);
          held.delete(key);
          for (const k of [...fileLoads]) if (k.startsWith(`${key}\0`)) fileLoads.delete(k);
          set((s) => ({ diffs: mapWithout(s.diffs, (k) => k === key), files: mapWithout(s.files, (k) => k.startsWith(`${key}\0`)) }));
        };
      },

      refresh(target) {
        if (held.has(diffKey(target))) void read(diffKey(target));
      },

      statusChanged(directory) {
        for (const [key, h] of held) if (h.target.directory === directory) schedule(h, key);
      },

      loadFile(target, path) {
        const key = fileKey(target, path);
        if (!held.has(diffKey(target)) || fileLoads.has(key)) return;
        fileLoads.add(key);
        set((s) => ({ files: mapWith(s.files, key, { status: 'loading' }) }));
        void settled(client.invoke('git.diff', diffInput(target, path))).then((result) => {
          if (!fileLoads.has(key)) return; // the scope re-read or was released meanwhile
          const next: FileDiff = result.ok ? { status: 'ok', file: splitPatch(result.value.patch)[0] ?? null } : { status: 'error', message: result.error.message };
          set((s) => ({ files: mapWith(s.files, key, next) }));
        });
      },

      lookupBase(repoRoot, branch) {
        const key = baseKey(repoRoot, branch);
        const known = get().bases.get(key);
        if (known && !(known.status === 'unavailable' && known.failed)) return;
        if (!branchCommand) {
          set((s) => ({ bases: mapWith(s.bases, key, { status: 'unavailable', reason: REVIEW_COPY.arrivesWithC10 }) }));
          return;
        }
        set((s) => ({ bases: mapWith(s.bases, key, { status: 'loading' }) }));
        // Untyped until C10's schema lands in the registry; its answer is `BranchStatus | null` (C10's document).
        const call = client.invoke(BRANCH_COMMAND as CommandName, { repoRoot, branch } as never) as Promise<CommandResult<CommandName>>;
        void settled(call).then((result) => {
          const value = result.ok ? (result.value as { base?: unknown } | null) : null;
          const next: BaseLookup = !result.ok
            ? { status: 'unavailable', reason: result.error.message, failed: true }
            : typeof value?.base !== 'string' || value.base === 'HEAD'
              ? { status: 'unavailable', reason: REVIEW_COPY.noMainBranch }
              : value.base === branch
                ? { status: 'unavailable', reason: REVIEW_COPY.mainWorktreeBranch(branch) }
                : { status: 'ok', base: value.base };
          set((s) => ({ bases: mapWith(s.bases, key, next) }));
        });
      },

      reset() {
        for (const h of held.values()) if (h.timer !== null) clearTimeout(h.timer);
        held.clear();
        fileLoads.clear();
        set({ diffs: new Map(), files: new Map(), bases: new Map() });
      },
    };
  });

  // A new status C8a's store took for a directory (its git.changed, or a watch's first answer) re-reads the scopes held
  // over that directory. Its status objects are replaced, never mutated, so a reference change is a new status.
  if (options.git) {
    const git = options.git;
    git.subscribe((state, prev) => {
      if (state.entries === prev.entries) return;
      for (const [directory, entry] of state.entries) {
        const before = prev.entries.get(directory);
        if (entry.status && before?.status && entry.status !== before.status) store.getState().statusChanged(directory);
      }
    });
  }
  return store;
}

// The whole patch is kept split per file within the cap; past it, only the list (each file fetched on selection).
function answered(diff: GitDiff): ScopeDiff {
  if (diff.patch.length > REVIEW_SCOPE_BYTES_CAP) return { status: 'ok', files: diff.files, patch: null };
  return { status: 'ok', files: diff.files, patch: new Map(splitPatch(diff.patch).map((file) => [file.path, file])) };
}

export const useReview = createReviewStore(ipc, { git: useGit });

// ---- what a Review surface shows for a session's directory and a scope ----------------------------------------------

const NOT_A_REPOSITORY = 'not a git repository'; // C4's message (src/main/git/runner.ts), as C8a's Environment reads it

export interface BranchAvailability {
  settled: boolean; // known: available or not, with the reason
  base: string | null;
  reason: string | null; // the disabled chip's tooltip
}

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
  // unchanged, so another turn streaming recomputes nothing here; the receipt is read with it.
  const turnKey = useTranscriptStore((s) => (scope === 'turn' && turnId !== null ? turnKeyOf(s.entries, appSessionId, turnId) : null));
  const activity = useTranscriptStore((s): TurnActivity | null => (turnKey !== null ? (s.activity(turnKey).find((a) => a.turnId === turnId) ?? null) : null));
  const turn = useMemo(() => {
    if (turnKey === null || turnId === null) return null;
    const entry = useTranscriptStore.getState().entries[turnKey];
    return entry ? { receipt: receiptOf(entry.rows, turnId), activity } : null;
  }, [turnKey, turnId, activity]);

  const list = useMemo<ReviewList>(() => {
    if (scope === null) return { phase: 'pending' };
    if (scope === 'turn') {
      if (!turn) return { phase: 'unavailable', message: REVIEW_COPY.unavailable(REVIEW_COPY.turnNotLoaded) };
      return { phase: 'ready', files: turnScopeFiles(turn.receipt?.files ?? [], turn.activity) };
    }
    if (!status) {
      if (gitError === NOT_A_REPOSITORY) return { phase: 'unavailable', message: REVIEW_COPY.notRepository };
      if (gitError) return { phase: 'unavailable', message: REVIEW_COPY.unavailable(gitError) };
      return { phase: 'pending' };
    }
    if (scope === 'branch' && branch.settled && branch.base === null) return { phase: 'unavailable', message: branch.reason ?? REVIEW_COPY.arrivesWithC10 };
    if (!diff || diff.status === 'loading') return { phase: 'pending' };
    if (diff.status === 'error') return { phase: 'unavailable', message: REVIEW_COPY.unavailable(diff.message) };
    return { phase: 'ready', files: gitScopeFiles({ scope, repoRoot: status.repoRoot, files: diff.files, patch: diff.patch, status }) };
  }, [scope, turn, status, gitError, branch, diff]);

  return { status, gitFailed: status === null && gitError !== null, branch, staged: indexDiffers(status), target, list };
}
