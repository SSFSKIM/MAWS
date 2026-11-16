// Stub: Source control's page model (UX wave U5b-2, M10), written test first.
import type { GitBranchCommit, GitBranchCommits, GitStatus } from '@shared/ipc/schema/git';
import type { ScmPrState } from '@shared/ipc/schema/scm';
import type { BranchRead } from '../code/review/branch-read';
import type { ReadFailure } from '../code/review/reads';

type Pr = NonNullable<ScmPrState['pr']>;
type Check = Pr['checks']['items'][number];
const notYet = (): never => {
  throw new Error('not built yet');
};

export type CommitsControl = { kind: 'none' } | { kind: 'show-all'; total: number } | { kind: 'show-some'; shown: number; total: number } | { kind: 'fewer'; older: number };
export interface CommitGroup { kind: 'not-pushed' | 'pushed'; upstream: string | null; count: number | null }
export type CommitsHeading = { kind: 'since'; count: number; base: string; behind: number } | { kind: 'latest'; branch: string | null };
export interface CommitList { heading: CommitsHeading; review: boolean; sections: { group: CommitGroup | null; commits: GitBranchCommit[] }[]; control: CommitsControl }
export const commitList = (_answer: GitBranchCommits, _branch: string | null, _whole: boolean): CommitList => notYet();
export const commitAge = (_authoredAt: string, _now: number): string => notYet();
export const ageColumnChars = (_ages: readonly string[]): number => notYet();
export type CommitsState = { kind: 'outstanding' } | { kind: 'ready'; answer: GitBranchCommits } | { kind: 'failed'; failure: ReadFailure; refresh: boolean };
export const commitsState = (_serves: boolean | null, _read: BranchRead | undefined, _offline: boolean): CommitsState => notYet();
export const mergeWords = (_pr: Pr): { kind: 'words'; words: string; tone: 'success' | 'danger' | 'muted' } | { kind: 'none' } | { kind: 'unknown'; value: string } => notYet();
export const stateLine = (_pr: Pr): { words: string; tone: 'fg' | 'success' | 'danger' | 'muted' }[] => notYet();
export const checksOf = (_pr: Pr): { counts: string; attention: Check[]; folded: Check[]; foldWords: string | null } | null => notYet();
export const conflictCount = (_status: Pick<GitStatus, 'files'>): number => notYet();
export const signInWay = (_local: boolean, _rights: readonly string[] | undefined): 'button' | 'needs-shell' | 'none' => notYet();
export const whereFit = (_m: { room: number; branch: number; branchMin: number; worktree: number; machine: number }): { shorten: boolean; worktree: boolean; machineBelow: boolean } => notYet();
export const commitsHeadingFit = (_m: { room: number; fixed: number; since: number; sinceMin: number; behind: number }): { since: 'whole' | 'shortened' | 'left-out' } => notYet();
export const uncommittedFit = (_m: { room: number; fixed: number; counts: number; conflicts: number }): { counts: boolean } => notYet();
