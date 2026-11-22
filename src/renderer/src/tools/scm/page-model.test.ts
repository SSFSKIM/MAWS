// Source control's page as pure derivations (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md,
// §H and §I; the frames' rulings S1 to S14, Decision Log 30 and 31): the commit list and its control, its groups and
// heading, the ages and their column, the Commits part's state over the branch read, the pull request's state line and
// checks, Sign in's way, and what each line gives up first where it lacks room (the measures come from the page).
import { describe, expect, it } from 'vitest';
import type { GitBranchCommit, GitBranchCommits } from '@shared/ipc/schema/git';
import { prOf } from '../../test-support/scm';
import {
  ageColumnChars,
  checksOf,
  commitAge,
  commitList,
  commitsHeadingFit,
  commitsState,
  conflictCount,
  mergeWords,
  signInWay,
  stateLine,
  uncommittedFit,
  whereFit,
} from './page-model';

const NOW = Date.parse('2026-11-16T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const sha = (n: number) => n.toString(16).padStart(40, '0');
const commit = (n: number, pushed: boolean | null, over: Partial<GitBranchCommit> = {}): GitBranchCommit => ({
  sha: sha(n),
  shortSha: sha(n).slice(0, 7),
  author: 'Ada Example',
  authoredAt: new Date(NOW - n * HOUR).toISOString(),
  subject: `Change ${n}`,
  parents: [sha(n + 1)],
  pushed,
  ...over,
});

// A branch of `all` commits since origin/main, the newest `notPushed` of them not pushed, read with the page's limit of 50
function branchOf(all: number, notPushed: number, over: Partial<GitBranchCommits> = {}): GitBranchCommits {
  const rows = Array.from({ length: Math.min(all, 50) }, (_, i) => commit(i + 1, i >= notPushed));
  return {
    base: { ref: 'origin/main', mergeBase: sha(999) },
    upstream: 'origin/feature/x',
    commits: rows,
    counts: { all, notPushed, pushed: all - notPushed },
    behind: 0,
    ...over,
  };
}

const shown = (list: ReturnType<typeof commitList>) => list.sections.flatMap((section) => section.commits).length;
const groups = (list: ReturnType<typeof commitList>) => list.sections.map((section) => (section.group === null ? null : [section.group.kind, section.group.count, section.commits.length]));

describe('the commit list’s control (frames’ S1, S2)', () => {
  it('draws eight rows and no control for a branch of eight commits', () => {
    const list = commitList(branchOf(8, 2), false);
    expect(shown(list)).toBe(8);
    expect(list.control).toEqual({ kind: 'none' });
  });

  it('offers "Show all 50 commits" for a branch of fifty, and lists all fifty once pressed, "Show fewer" after the last', () => {
    const folded = commitList(branchOf(50, 2), false);
    expect(shown(folded)).toBe(8);
    expect(folded.control).toEqual({ kind: 'show-all', total: 50 });
    const whole = commitList(branchOf(50, 2), true);
    expect(shown(whole)).toBe(50);
    expect(whole.control).toEqual({ kind: 'fewer', older: 0 });
  });

  it('never says "all" for a branch of sixty: "Show 50 of 60 commits", then "10 older commits not shown" before "Show fewer"', () => {
    const folded = commitList(branchOf(60, 55), false);
    expect(folded.control).toEqual({ kind: 'show-some', shown: 50, total: 60 });
    const whole = commitList(branchOf(60, 55), true);
    expect(shown(whole)).toBe(50);
    expect(whole.control).toEqual({ kind: 'fewer', older: 10 });
  });

  it('counts one older commit for a branch of fifty-one', () => {
    expect(commitList(branchOf(51, 1), true).control).toEqual({ kind: 'fewer', older: 1 });
  });
});

describe('the commit list’s groups and heading (S1, S4; frames’ S8)', () => {
  it('groups the rows under "Not pushed" and "Pushed to <upstream>", each count the whole range’s', () => {
    const list = commitList(branchOf(4, 2), false);
    expect(list.heading).toEqual({ kind: 'since', count: 4, base: 'origin/main', behind: 0 });
    expect(list.review).toBe(true);
    expect(groups(list)).toEqual([
      ['not-pushed', 2, 2],
      ['pushed', 2, 2],
    ]);
    expect(list.sections[1]!.group!.upstream).toBe('origin/feature/x');
  });

  it('keeps a group’s count true when its rows are cut, and draws a group whose rows fall below the cut', () => {
    const list = commitList(branchOf(60, 55), false);
    expect(groups(list)).toEqual([
      ['not-pushed', 55, 8],
      ['pushed', 5, 0],
    ]);
  });

  it('draws one group when the other is empty, and no group with no upstream but "Not pushed"', () => {
    expect(groups(commitList(branchOf(5, 0), false))).toEqual([['pushed', 5, 5]]);
    const unpublished = branchOf(3, 3, { upstream: null, counts: { all: 3, notPushed: 3, pushed: 0 } });
    expect(groups(commitList(unpublished, false))).toEqual([['not-pushed', 3, 3]]);
  });

  it('lists the rows with no groups when git cannot resolve the upstream', () => {
    const gone = branchOf(3, 0, { commits: [commit(1, null), commit(2, null), commit(3, null)], counts: { all: 3, notPushed: null, pushed: null } });
    expect(groups(commitList(gone, false))).toEqual([null]);
  });

  it('with no base, reads "latest" (the word cut, N62), lists eight rows of HEAD with no "Review ›", and groups only where an upstream exists, with no count', () => {
    const rows = Array.from({ length: 12 }, (_, i) => commit(i + 1, true));
    const tracked = commitList({ base: null, upstream: 'origin/feature/x', commits: rows, counts: null, behind: null }, false);
    expect(tracked.heading).toEqual({ kind: 'latest' });
    expect(tracked.review).toBe(false);
    expect(tracked.control).toEqual({ kind: 'none' });
    expect(groups(tracked)).toEqual([['pushed', null, 8]]);
    const local = commitList({ base: null, upstream: null, commits: rows.map((row) => ({ ...row, pushed: false })), counts: null, behind: null }, false);
    expect(groups(local)).toEqual([null]);
    expect(shown(local)).toBe(8);
  });


  it('carries how far behind the base the branch is', () => {
    expect(commitList(branchOf(5, 1, { behind: 3 }), false).heading).toEqual({ kind: 'since', count: 5, base: 'origin/main', behind: 3 });
  });
});

describe('a commit’s age and the age column (frames’ S12)', () => {
  it('is minutes under an hour (at least one), hours under a day, and days after, with no other unit', () => {
    expect(commitAge(new Date(NOW - 10_000).toISOString(), NOW)).toBe('1m');
    expect(commitAge(new Date(NOW - 12 * MINUTE).toISOString(), NOW)).toBe('12m');
    expect(commitAge(new Date(NOW - 2 * HOUR - 5 * MINUTE).toISOString(), NOW)).toBe('2h');
    expect(commitAge(new Date(NOW - 3 * DAY).toISOString(), NOW)).toBe('3d');
    expect(commitAge(new Date(NOW - 1003 * DAY).toISOString(), NOW)).toBe('1003d');
  });

  it('is at least four characters wide, and as wide as the widest age drawn', () => {
    expect(ageColumnChars(['12m', '2h'])).toBe(4);
    expect(ageColumnChars(['981d', '1003d', '2h'])).toBe(5);
  });
});

describe('the Commits part’s state over the branch read (frames’ S9)', () => {
  const answer = branchOf(4, 2);
  it('is outstanding while the first read is out, and while whether the machine serves the reads is not known', () => {
    expect(commitsState(true, undefined, false)).toEqual({ kind: 'outstanding' });
    expect(commitsState(true, { answer: null, failure: null }, false)).toEqual({ kind: 'outstanding' });
    expect(commitsState(null, undefined, false)).toEqual({ kind: 'outstanding' });
  });

  it('is older, with no refresh, for a machine that lists its capabilities without the reads, an unknown command and an endpoint that does not offer them', () => {
    expect(commitsState(false, undefined, false)).toEqual({ kind: 'failed', failure: { kind: 'older' }, refresh: false });
    expect(commitsState(true, { answer: null, failure: { status: 'error', message: 'unknown', code: 'unknown_command' } }, false)).toEqual({ kind: 'failed', failure: { kind: 'older' }, refresh: false });
    expect(commitsState(true, { answer: null, failure: { status: 'error', message: 'refused', refusal: 'not-offered' } }, false)).toEqual({ kind: 'failed', failure: { kind: 'older' }, refresh: false });
  });

  it('keeps what was last read through an offline failure, and says offline with a refresh when nothing was read', () => {
    const down = { status: 'error' as const, message: 'the link dropped', code: 'host_unavailable' };
    expect(commitsState(true, { answer, failure: down }, false)).toEqual({ kind: 'ready', answer });
    expect(commitsState(true, { answer: null, failure: down }, false)).toEqual({ kind: 'failed', failure: { kind: 'offline' }, refresh: true });
    expect(commitsState(true, { answer: null, failure: { status: 'error', message: 'fatal' } }, true)).toEqual({ kind: 'failed', failure: { kind: 'offline' }, refresh: true });
  });

  it('says a refusal and git’s failure with a refresh, also over a kept answer', () => {
    expect(commitsState(true, { answer: null, failure: { status: 'error', message: 'refused', refusal: 'no-target' } }, false)).toEqual({ kind: 'failed', failure: { kind: 'refused', refusal: 'no-target' }, refresh: true });
    expect(commitsState(true, { answer, failure: { status: 'error', message: 'git rev-list failed' } }, false)).toEqual({ kind: 'failed', failure: { kind: 'failed', message: 'git rev-list failed' }, refresh: true });
  });

  it('is the answer once read', () => {
    expect(commitsState(true, { answer, failure: null }, false)).toEqual({ kind: 'ready', answer });
  });

  // The branch's max panel, ruling 1 (Decision Log 49): an answer in hand stays shown when the machine stops serving the
  // reads; "older" and "outstanding" are for a list with no answer
  it('keeps an answer in hand when the machine no longer serves the reads or is not known to, whatever failed last', () => {
    const down = { status: 'error' as const, message: 'the link dropped', code: 'host_unavailable' };
    const unknown = { status: 'error' as const, message: 'unknown', code: 'unknown_command' };
    for (const serves of [false, null] as const) {
      expect(commitsState(serves, { answer, failure: null }, false), String(serves)).toEqual({ kind: 'ready', answer });
      expect(commitsState(serves, { answer, failure: null }, true), String(serves)).toEqual({ kind: 'ready', answer });
      expect(commitsState(serves, { answer, failure: down }, true), String(serves)).toEqual({ kind: 'ready', answer });
      expect(commitsState(serves, { answer, failure: unknown }, false), String(serves)).toEqual({ kind: 'ready', answer });
    }
    expect(commitsState(false, { answer: null, failure: null }, false)).toEqual({ kind: 'failed', failure: { kind: 'older' }, refresh: false });
    expect(commitsState(null, { answer: null, failure: down }, false)).toEqual({ kind: 'outstanding' });
  });
});

describe('the pull request’s state line and checks (S5, S6; frames’ S11)', () => {
  const check = (name: string, bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel', link: string | null = `https://github.com/o/r/runs/${name}`) => ({ name, bucket, state: bucket.toUpperCase(), link, workflow: null });

  it('reads every merge state GitHub publishes, and words a value it adds later under the line', () => {
    const of = (value: string | null) => mergeWords(prOf({ mergeStateStatus: value }));
    expect(of('CLEAN')).toEqual({ kind: 'words', words: 'Ready to merge', tone: 'success' });
    expect(of('HAS_HOOKS')).toEqual({ kind: 'words', words: 'Ready to merge', tone: 'success' });
    expect(of('DIRTY')).toEqual({ kind: 'words', words: 'Conflicts with main', tone: 'danger' });
    expect(of('BEHIND')).toEqual({ kind: 'words', words: 'Behind main', tone: 'muted' });
    expect(of('BLOCKED')).toEqual({ kind: 'words', words: 'Merging is blocked', tone: 'muted' });
    for (const none of ['UNSTABLE', 'DRAFT', 'UNKNOWN', null]) expect(of(none)).toEqual({ kind: 'none' });
    expect(of('QUEUED')).toEqual({ kind: 'unknown', value: 'QUEUED' });
  });

  it('is the state, the base, the review decision and, while open, the merge words, phrase by phrase; an open pull request’s state unsaid (the word cut, N72)', () => {
    expect(stateLine(prOf({ reviewDecision: 'CHANGES_REQUESTED', mergeStateStatus: 'DIRTY' }))).toEqual([
      { words: 'into main', tone: 'fg' },
      { words: 'Changes requested', tone: 'fg' },
      { words: 'Conflicts with main', tone: 'danger' },
    ]);
    expect(stateLine(prOf({ state: 'MERGED', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED' }))).toEqual([
      { words: 'Merged', tone: 'fg' },
      { words: 'into main', tone: 'fg' },
      { words: 'Approved', tone: 'fg' },
    ]);
    expect(stateLine(prOf({ isDraft: true }))[0]).toEqual({ words: 'Draft', tone: 'fg' });
    expect(stateLine(prOf({ state: 'CLOSED' }))[0]).toEqual({ words: 'Closed', tone: 'fg' });
  });

  it('counts the listed checks in the card’s words (the word cut, N75: the passed and skipped are the folded line’s), lists failed, cancelled and pending rows in that order, and folds the passed and skipped in the answer’s order', () => {
    const items = [check('build', 'pass'), check('integration', 'pending'), check('docs', 'skipping', null), check('e2e', 'cancel'), check('unit tests', 'fail'), check('lint', 'pass'), check('types', 'pass')];
    const checks = checksOf(prOf({ checks: { summary: 'fail', items } }))!;
    expect(checks.counts).toBe('1 failed · 1 cancelled · 1 pending');
    expect(checks.attention.map((c) => [c.name, c.bucket])).toEqual([
      ['unit tests', 'fail'],
      ['e2e', 'cancel'],
      ['integration', 'pending'],
    ]);
    expect(checks.folded.map((c) => c.name)).toEqual(['build', 'docs', 'lint', 'types']);
    expect(checks.foldWords).toBe('3 passed · 1 skipped');
  });

  // Decision Log 41: with no row to list, the counts line is not drawn and the folded line stands in its place
  it('draws no counts line when every check passed, the folded line in its place', () => {
    const checks = checksOf(prOf({ checks: { summary: 'pass', items: [check('build', 'pass'), check('lint', 'pass'), check('unit tests', 'pass')] } }))!;
    expect(checks.countsLine).toBe(false);
    expect(checks.attention).toEqual([]);
    expect(checks.foldWords).toBe('3 passed');
    expect(checks.folded.map((c) => c.name)).toEqual(['build', 'lint', 'unit tests']);
  });

  it('draws no counts line when the checks passed or were skipped, the folded line naming both', () => {
    const checks = checksOf(prOf({ checks: { summary: 'pass', items: [check('build', 'pass'), check('docs', 'skipping', null), check('lint', 'pass')] } }))!;
    expect(checks.countsLine).toBe(false);
    expect(checks.foldWords).toBe('2 passed · 1 skipped');
    expect(checks.folded.map((c) => c.name)).toEqual(['build', 'docs', 'lint']);
  });

  it('draws both lines when one check failed beside the passed', () => {
    const checks = checksOf(prOf({ checks: { summary: 'fail', items: [check('build', 'pass'), check('unit tests', 'fail'), check('lint', 'pass')] } }))!;
    expect(checks.countsLine).toBe(true);
    expect(checks.counts).toBe('1 failed');
    expect(checks.attention.map((c) => c.name)).toEqual(['unit tests']);
    expect(checks.foldWords).toBe('2 passed');
  });

  it('keeps the counts line where nothing is listed and nothing folds (no checks yet, checks unavailable)', () => {
    expect(checksOf(prOf({ checks: { summary: 'none', items: [] } }))!.countsLine).toBe(true);
    expect(checksOf(prOf({ checks: { summary: 'unknown', items: [] } }))!.countsLine).toBe(true);
  });

  it('lists no checks for a merged or a closed pull request', () => {
    expect(checksOf(prOf({ state: 'MERGED', checks: { summary: 'pass', items: [check('build', 'pass')] } }))).toBeNull();
    expect(checksOf(prOf({ state: 'CLOSED', checks: { summary: 'pass', items: [check('build', 'pass')] } }))).toBeNull();
  });
});

describe('Uncommitted’s conflicts (frames’ S14)', () => {
  it('counts the status’s unmerged entries', () => {
    const file = (path: string, index: string, worktree: string) => ({ path, oldPath: null, index, worktree, untracked: false });
    expect(conflictCount({ files: [file('a.ts', 'U', 'U'), file('b.ts', 'A', 'A'), file('c.ts', '.', 'M')] })).toBe(2);
  });
});

describe('Sign in on another machine (decision 21; frames’ S10)', () => {
  it('is the card’s button on this Mac; elsewhere a button by the shell right, the sentence without it, and neither while the rights are not known', () => {
    expect(signInWay(true, undefined)).toBe('button');
    expect(signInWay(false, ['spawn', 'shell'])).toBe('button');
    expect(signInWay(false, ['spawn'])).toBe('needs-shell');
    expect(signInWay(false, undefined)).toBe('none');
  });
});

describe('what each line gives up where it lacks room (frames’ S4, S6)', () => {
  // widths in pixels, as the page measures them; a room of 0 is a page not laid out yet
  const where = { branch: 160, branchMin: 70, worktree: 60, machine: 110 };

  it('the Where line: the branch’s name shortens first, then "· worktree" goes, then the machine’s label moves to a second line', () => {
    expect(whereFit({ room: 0, ...where })).toEqual({ shorten: false, worktree: true, machineBelow: false });
    expect(whereFit({ room: 330, ...where })).toEqual({ shorten: false, worktree: true, machineBelow: false });
    expect(whereFit({ room: 300, ...where })).toEqual({ shorten: true, worktree: true, machineBelow: false });
    expect(whereFit({ room: 200, ...where })).toEqual({ shorten: true, worktree: false, machineBelow: false });
    expect(whereFit({ room: 150, ...where })).toEqual({ shorten: true, worktree: false, machineBelow: true });
  });

  it('never shortens a detached HEAD’s words: "· worktree" goes, then the machine moves', () => {
    const detached = { branch: 140, branchMin: 140, worktree: 60, machine: 110 };
    expect(whereFit({ room: 300, ...detached })).toEqual({ shorten: false, worktree: false, machineBelow: false });
    expect(whereFit({ room: 200, ...detached })).toEqual({ shorten: false, worktree: false, machineBelow: true });
  });

  it('the Commits heading: the base’s name shortens, "· N behind" stays whole, and "since <base>" is left out whole when even that does not fit', () => {
    const heading = { fixed: 150, since: 120, sinceMin: 90, behind: 70 };
    expect(commitsHeadingFit({ room: 0, ...heading })).toEqual({ since: 'whole' });
    expect(commitsHeadingFit({ room: 340, ...heading })).toEqual({ since: 'whole' });
    expect(commitsHeadingFit({ room: 320, ...heading })).toEqual({ since: 'shortened' });
    expect(commitsHeadingFit({ room: 280, ...heading })).toEqual({ since: 'left-out' });
  });

  it('Uncommitted: the "+A −R" counts are left out whole before anything of the conflicts', () => {
    const line = { fixed: 170, counts: 70, conflicts: 80 };
    expect(uncommittedFit({ room: 0, ...line })).toEqual({ counts: true });
    expect(uncommittedFit({ room: 320, ...line })).toEqual({ counts: true });
    expect(uncommittedFit({ room: 300, ...line })).toEqual({ counts: false });
  });
});
