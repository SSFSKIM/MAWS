// W9 (H2; waves plan §2 H and §6, the architect's ruling of 2026-10-01): the one rule every branch label follows, the
// header toolbar's chip, the composer's location chip, the Overview card, the sidebar's hover card and its worktree
// group labels alike. Once git has answered, its answer decides: the checkout's branch, "detached" when HEAD is
// detached, and no label at all for a folder that is not a repository (Codex's projectless chat shows none). Before git
// has answered, and for a reader that asks git nothing, a reader shows only a branch the record names and never a
// placeholder; `HEAD` and empty never count as one (the engine writes `HEAD` for a non-repository and a detached
// checkout alike, so only git can tell them apart).
import type { SessionRecord } from '@shared/graph/session';
import { branchName } from '@shared/sessions/branch';

export const DETACHED = 'detached';
// C4's message for a folder outside any repository (src/main/git/runner.ts, NotARepositoryError)
export const NOT_A_REPOSITORY = 'not a git repository';

// What git answered for a directory: a checkout and its branch (null when HEAD is detached), or no repository.
export type GitBranchAnswer = { repository: true; branch: string | null } | { repository: false };

export function branchLabel(recorded: string | null | undefined, git: GitBranchAnswer | null = null): string | null {
  if (git === null) return branchName(recorded);
  return git.repository ? (git.branch ?? DETACHED) : null;
}

// The branch a record names: its worktree's (C10's launch, or the index's for a session in a worktree), else the
// index's from the transcript's latest record.
export const recordBranch = (record: Pick<SessionRecord, 'branch' | 'worktree'> | null | undefined): string | null =>
  branchName(record?.worktree?.branch) ?? branchName(record?.branch);

// A git watch's state (the composer's `useGitWatch`, the git store's entry) as an answer: a status is one, and so is
// C4's not-a-repository refusal; nothing yet, or any other failure (git could not be read), is none.
export function gitAnswerOf(watch: { status: { branch: string | null } | null; error: string | null } | null | undefined): GitBranchAnswer | null {
  if (!watch) return null;
  if (watch.status) return { repository: true, branch: watch.status.branch };
  return watch.error === NOT_A_REPOSITORY ? { repository: false } : null;
}
