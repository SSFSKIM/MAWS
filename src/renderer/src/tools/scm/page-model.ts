// Source control's page as pure derivations (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md,
// §H and §I; the frames' rulings S1 to S14, Decision Log 30 and 31). The page (SourceControlPage.tsx) reads the git
// store's status, the branch read's store (review/branch-read.ts) and the two scm queries, and draws what these say: the
// commit list with its groups, heading and control; a commit's age and the age column; the Commits part's state over the
// branch read, told apart by Review's `readFailure` (review/reads.ts; Decision Log 36 a); the pull request's state line and
// checks; Sign in's way on another machine; and, from the widths the page measures, what each line gives up first.
import type { GitBranchCommit, GitBranchCommits, GitStatus } from '@shared/ipc/schema/git';
import type { ScmPrState } from '@shared/ipc/schema/scm';
import { SUMMARY_COPY } from '../../panel/copy';
import type { BranchRead } from '../code/review/branch-read';
import { readFailure, type ReadFailure } from '../code/review/reads';
import { unmerged } from '../code/review/review-model';
import { SCM_COPY } from './copy';

type Pr = NonNullable<ScmPrState['pr']>;
export type Check = Pr['checks']['items'][number];

// The commit list

export const COMMITS_FOLDED = 8; // rows shown until the list is shown whole (frames' S1): the pull request stays in view

/** The line after the list: none, "Show all N commits", "Show 50 of N commits", or, shown whole, "Show fewer" after "M older commits not shown" where M > 0. */
export type CommitsControl = { kind: 'none' } | { kind: 'show-all'; total: number } | { kind: 'show-some'; shown: number; total: number } | { kind: 'fewer'; older: number };
/** A group's line: "Not pushed N" or "Pushed to <upstream> N"; the count is the whole range's, null where it is not known. */
export interface CommitGroup {
  kind: 'not-pushed' | 'pushed';
  upstream: string | null;
  count: number | null;
}
/** "Commits N since <base>" with "· N behind", or with no base "Commits · latest on <branch>" ("Commits · latest" detached). */
export type CommitsHeading = { kind: 'since'; count: number; base: string; behind: number } | { kind: 'latest'; branch: string | null };
export interface CommitList {
  heading: CommitsHeading;
  review: boolean; // the heading's "Review ›": only where there is a base (the scope it opens is disabled without one)
  sections: { group: CommitGroup | null; commits: GitBranchCommit[] }[]; // newest first; one section with no group where the rows are not grouped
  control: CommitsControl;
}

/** What the list draws of a branch read's answer: `whole` is the page's fold (the list shown whole). */
export function commitList(answer: GitBranchCommits, branch: string | null, whole: boolean): CommitList {
  const { base, upstream, commits, counts } = answer;
  if (base === null) {
    const rows = commits.slice(0, COMMITS_FOLDED);
    return { heading: { kind: 'latest', branch }, review: false, sections: sectionsOf(rows, upstream, null), control: { kind: 'none' } };
  }
  const total = counts?.all ?? commits.length;
  const heading: CommitsHeading = { kind: 'since', count: total, base: base.ref, behind: answer.behind ?? 0 };
  let rows = commits;
  let control: CommitsControl = { kind: 'none' };
  if (total > COMMITS_FOLDED) {
    if (whole) control = { kind: 'fewer', older: Math.max(0, total - commits.length) };
    else {
      rows = commits.slice(0, COMMITS_FOLDED);
      control = total <= commits.length ? { kind: 'show-all', total } : { kind: 'show-some', shown: commits.length, total };
    }
  }
  return { heading, review: true, sections: sectionsOf(rows, upstream, counts), control };
}

// The groups (S1, S4; frames' S8): with no upstream the one group "Not pushed" where the range is counted, and no group
// where it is not (no base); with an upstream git cannot resolve, no group; otherwise a group for each side its count (or,
// with no count, its rows) says is not empty, each holding its own rows.
function sectionsOf(rows: GitBranchCommit[], upstream: string | null, counts: GitBranchCommits['counts']): CommitList['sections'] {
  const ungrouped = [{ group: null, commits: rows }];
  if (upstream === null) return counts === null ? ungrouped : [{ group: { kind: 'not-pushed', upstream: null, count: counts.notPushed }, commits: rows }];
  if ((counts !== null && counts.notPushed === null) || rows.some((row) => row.pushed === null)) return ungrouped;
  const notPushed = rows.filter((row) => row.pushed === false);
  const pushed = rows.filter((row) => row.pushed === true);
  const sections: CommitList['sections'] = [];
  const counted = (count: number | null | undefined, held: number) => (counts === null ? held > 0 : (count ?? 0) > 0);
  if (counted(counts?.notPushed, notPushed.length)) sections.push({ group: { kind: 'not-pushed', upstream: null, count: counts?.notPushed ?? null }, commits: notPushed });
  if (counted(counts?.pushed, pushed.length)) sections.push({ group: { kind: 'pushed', upstream, count: counts?.pushed ?? null }, commits: pushed });
  return sections.length === 0 ? ungrouped : sections;
}

// A commit's age (frames' S12): minutes under an hour (at least one), hours under a day, days after; no other unit, so an
// old commit's age can be five characters or more.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export function commitAge(authoredAt: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(authoredAt));
  if (ms < HOUR) return SCM_COPY.age(Math.max(1, Math.floor(ms / MINUTE)), 'm');
  if (ms < DAY) return SCM_COPY.age(Math.floor(ms / HOUR), 'h');
  return SCM_COPY.age(Math.floor(ms / DAY), 'd');
}

/** The age column's width in characters: the widest age drawn, and at least four. */
export const ageColumnChars = (ages: readonly string[]): number => Math.max(4, ...ages.map((age) => age.length));

// The Commits part's state (§H's "Refusals told apart"; frames' S9)

export type CommitsState = { kind: 'outstanding' } | { kind: 'ready'; answer: GitBranchCommits } | { kind: 'failed'; failure: ReadFailure; refresh: boolean };

/**
 * `serves`: the machine serves the reads (`servesReads`); `read`: the branch read's entry; `offline`: the machine's phase.
 * Outstanding while nothing is known; older, with nothing asked and no refresh, for a machine that lists its capabilities
 * without the reads; an offline failure keeps what was last read; every other failure is said, with a refresh where a new
 * read can change the answer.
 */
export function commitsState(serves: boolean | null, read: BranchRead | undefined, offline: boolean): CommitsState {
  if (serves === false) return { kind: 'failed', failure: { kind: 'older' }, refresh: false };
  if (serves === null || read === undefined) return { kind: 'outstanding' };
  if (read.failure === null) return read.answer === null ? { kind: 'outstanding' } : { kind: 'ready', answer: read.answer };
  const failure = readFailure(read.failure, offline);
  if (failure.kind === 'offline' && read.answer !== null) return { kind: 'ready', answer: read.answer };
  return { kind: 'failed', failure, refresh: failure.kind !== 'older' };
}

// The pull request

export type Tone = 'fg' | 'success' | 'danger' | 'muted';
export type MergeWords = { kind: 'words'; words: string; tone: Exclude<Tone, 'fg'> } | { kind: 'none' } | { kind: 'unknown'; value: string };

/** Whether an open pull request can merge, by `mergeStateStatus`: every value GitHub publishes, and a word for one it adds later. */
export function mergeWords(pr: Pr): MergeWords {
  const value = pr.mergeStateStatus;
  switch (value) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { kind: 'words', words: SCM_COPY.readyToMerge, tone: 'success' };
    case 'DIRTY':
      return { kind: 'words', words: SCM_COPY.conflictsWith(pr.baseRefName), tone: 'danger' };
    case 'BEHIND':
      return { kind: 'words', words: SCM_COPY.behindBase(pr.baseRefName), tone: 'muted' };
    case 'BLOCKED':
      return { kind: 'words', words: SCM_COPY.mergeBlocked, tone: 'muted' };
    case 'UNSTABLE':
    case 'DRAFT':
    case 'UNKNOWN':
    case null:
      return { kind: 'none' };
    default:
      return { kind: 'unknown', value };
  }
}

const isOpen = (pr: Pr) => pr.state !== 'MERGED' && pr.state !== 'CLOSED';

/** The state line's phrases: the state, "into <base>", the review decision in the card's words, and while open the merge words. */
export function stateLine(pr: Pr): { words: string; tone: Tone }[] {
  const words = SUMMARY_COPY.prState;
  const state = pr.state === 'MERGED' ? words.merged : pr.state === 'CLOSED' ? words.closed : pr.isDraft ? words.draft : words.open;
  const phrases: { words: string; tone: Tone }[] = [
    { words: state, tone: 'fg' },
    { words: SCM_COPY.into(pr.baseRefName), tone: 'fg' },
  ];
  const review = pr.reviewDecision === null ? undefined : SUMMARY_COPY.reviewDecision[pr.reviewDecision];
  if (review !== undefined) phrases.push({ words: review, tone: 'fg' });
  const merge = isOpen(pr) ? mergeWords(pr) : null;
  if (merge?.kind === 'words') phrases.push({ words: merge.words, tone: merge.tone });
  return phrases;
}

const BUCKET_WORDS = new Map<Check['bucket'], string>(SUMMARY_COPY.checkBuckets);
export const bucketWord = (bucket: Check['bucket']): string => BUCKET_WORDS.get(bucket)!;
const ATTENTION: readonly Check['bucket'][] = ['fail', 'cancel', 'pending'];
const countsOf = (items: readonly Check[], buckets: readonly Check['bucket'][]) =>
  SUMMARY_COPY.checkBuckets.filter(([bucket]) => buckets.includes(bucket)).flatMap(([bucket, word]) => {
    const n = items.filter((item) => item.bucket === bucket).length;
    return n > 0 ? [SCM_COPY.checkCount(n, word)] : [];
  });

export interface Checks {
  counts: string; // the counts line, in the card's bucket words and order ("3 passed · 1 failed · 1 pending")
  countParts: string[]; // the same, one count apiece (the line wraps between them)
  attention: Check[]; // failed, cancelled and pending, in that order
  folded: Check[]; // passed and skipped, in the answer's order
  foldWords: string | null; // the folded line ("3 passed · 1 skipped"); null with nothing to fold
}

/** An open pull request's checks; null for a merged or a closed one, which lists none. */
export function checksOf(pr: Pr): Checks | null {
  if (!isOpen(pr)) return null;
  const { summary, items } = pr.checks;
  const countParts = summary === 'unknown' ? [SUMMARY_COPY.checksUnavailable] : items.length === 0 ? [SUMMARY_COPY.noChecks] : countsOf(items, ['pass', 'fail', 'cancel', 'pending', 'skipping']);
  const folded = items.filter((item) => item.bucket === 'pass' || item.bucket === 'skipping');
  const fold = countsOf(items, ['pass', 'skipping']);
  return {
    counts: countParts.join(' · '),
    countParts,
    attention: ATTENTION.flatMap((bucket) => items.filter((item) => item.bucket === bucket)),
    folded,
    foldWords: fold.length === 0 ? null : fold.join(' · '),
  };
}

// Uncommitted's conflicts: the status's unmerged entries (Review's predicate).
export const conflictCount = (status: Pick<GitStatus, 'files'>): number => status.files.filter(unmerged).length;

/** Sign in where the GitHub CLI is signed out (decision 21): the card's button on this Mac; elsewhere by the `shell` right, its sentence without it, and neither while the rights are not known. */
export function signInWay(local: boolean, rights: readonly string[] | undefined): 'button' | 'needs-shell' | 'none' {
  if (local) return 'button';
  if (rights === undefined) return 'none';
  return rights.includes('shell') ? 'button' : 'needs-shell';
}

// What gives way where a line lacks room (frames' S4, S6), from widths the page measures in pixels. A room of 0 is a page
// not laid out yet, and every decision then takes its whole form, as Review's toolbar does.

/**
 * The Where line, in a fixed order and never by cutting its end: (1) the branch's name shortens at its end, to its
 * shortest (eight characters and an ellipsis: `branchMin`); (2) "· worktree" is left out; (3) the machine's label, with
 * "· offline", moves to a second line. A detached HEAD's words never shorten: the page gives `branchMin` equal to `branch`.
 */
export function whereFit({ room, branch, branchMin, worktree, machine }: { room: number; branch: number; branchMin: number; worktree: number; machine: number }): { shorten: boolean; worktree: boolean; machineBelow: boolean } {
  const shortens = branchMin < branch;
  if (room <= 0 || branch + worktree + machine <= room) return { shorten: false, worktree: true, machineBelow: false };
  if (shortens && branchMin + worktree + machine <= room) return { shorten: true, worktree: true, machineBelow: false };
  if (branchMin + machine <= room) return { shorten: shortens, worktree: false, machineBelow: false };
  return { shorten: shortens, worktree: false, machineBelow: true };
}

/** The Commits heading: "since <base>" whole, its base shortened (to `sinceMin`), or the phrase left out whole; "· N behind" always whole. */
export function commitsHeadingFit({ room, fixed, since, sinceMin, behind }: { room: number; fixed: number; since: number; sinceMin: number; behind: number }): { since: 'whole' | 'shortened' | 'left-out' } {
  if (room <= 0 || fixed + since + behind <= room) return { since: 'whole' };
  if (sinceMin < since && fixed + sinceMin + behind <= room) return { since: 'shortened' };
  return { since: 'left-out' };
}

/** Uncommitted: the "+A −R" counts are left out whole before anything of the conflicts is. */
export function uncommittedFit({ room, fixed, counts, conflicts }: { room: number; fixed: number; counts: number; conflicts: number }): { counts: boolean } {
  return { counts: room <= 0 || fixed + counts + conflicts <= room };
}
