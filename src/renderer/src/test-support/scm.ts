// Source control's page tests (E6; UX wave U5b-2, M10): a C4 status to vary per case, the reads `scm.*` answers, and
// main as the page reads it (`scmMain`). Imported only by happy-dom suites. What only the acting pane's suites used (its
// plans, run tokens, refusals, scratch patches) left with them in M11.
import type { AppSessionId } from '@shared/graph/ids';
import type { GitBranchCommit, GitBranchCommits, GitDiff, GitStatus } from '@shared/ipc/schema/git';
import type { ScmPrState, ScmStatus } from '@shared/ipc/schema/scm';
import { fail, installFakeMain, ok } from './code';

type Answer = ReturnType<typeof ok> | ReturnType<typeof fail>;

export const A = 'app-a' as AppSessionId;
export const B = 'app-b' as AppSessionId;
export const DIR = '/repo';

export function statusOf(over: Partial<GitStatus> = {}): GitStatus {
  return {
    repoRoot: DIR,
    gitDir: `${DIR}/.git`,
    commonDir: `${DIR}/.git`,
    isWorktree: false,
    branch: 'main',
    head: '0123456789abcdef0123456789abcdef01234567',
    upstream: 'origin/main',
    remoteUrl: null,
    ahead: 0,
    behind: 0,
    dirty: true,
    files: [],
    stashCount: 0,
    checkedAt: '2026-10-06T10:00:00.000Z',
    ...over,
  };
}

export function scmStatusOf(over: Partial<ScmStatus> = {}): ScmStatus {
  return {
    directory: DIR,
    repository: true,
    trusted: true,
    trustKey: DIR,
    remotes: [{ name: 'origin', url: 'https://github.com/o/r.git' }],
    defaultRemote: 'origin',
    defaultBase: 'main',
    gh: { state: 'missing' },
    checkedAt: '2026-10-06T10:00:00.000Z',
    ...over,
  };
}

// The commands the page sends: the reads, and a link opened outside the window
type ScmCommand = 'scm.status' | 'git.diff' | 'scm.pr.state' | 'layout.openExternal' | 'git.branchCommits';

// Main as Source control's page reads it: C4's watch and the uncommitted diff over a scripted status, `scm.status`,
// `scm.pr.state` and the branch read. Any other command fails, so a page that asked one would show it. `change`
// replaces the status and emits C4's `git.changed`, as the watcher's refresh does.
export function scmMain(init: { status?: GitStatus; scm?: ScmStatus } = {}) {
  const state = {
    status: init.status ?? statusOf(),
    scm: init.scm ?? scmStatusOf(),
    watchError: null as string | null,
    diffs: { worktree: { patch: '', files: [] } } as Record<'worktree', GitDiff>, // what the git store's uncommitted read answers
    branch: branchCommitsOf(), // UX wave U5b-2 (M10): what `git.branchCommits` answers unless a case scripts it
    answers: {} as Partial<Record<ScmCommand, (input: Record<string, unknown>) => Answer | Promise<Answer>>>,
  };
  const fake = installFakeMain((name, input) => {
    switch (name) {
      case 'git.watch':
        return state.watchError !== null ? fail(state.watchError) : ok(state.status);
      case 'git.unwatch':
        return ok();
      case 'git.diff':
        return state.answers['git.diff']?.(input) ?? ok(state.diffs.worktree); // the git store's uncommitted read (scope `all`)
      case 'scm.status':
        return state.answers['scm.status']?.(input) ?? ok(state.scm);
      case 'scm.pr.state':
        return state.answers[name]?.(input) ?? ok(prStateOf());
      case 'layout.openExternal':
        return state.answers[name]?.(input) ?? ok();
      case 'git.branchCommits':
        return state.answers[name]?.(input) ?? ok(state.branch);
      default:
        return fail(`no answer for ${name} in the source control suites`);
    }
  });
  return {
    ...fake,
    state,
    change(status: GitStatus) {
      state.status = status;
      fake.emit('git.changed', { repoRoot: status.repoRoot, status, reason: 'index' });
    },
  };
}

// `scm.pr.state` with no PR for the branch (M4); a case passes `pr` to show one.
export function prStateOf(over: Partial<ScmPrState> = {}): ScmPrState {
  return { checkedAt: '2026-10-06T10:00:00.000Z', branch: 'main', gh: { state: 'ready', path: '/opt/homebrew/bin/gh', version: '2.97.0' }, pr: null, error: null, ...over };
}

export function prOf(over: Partial<NonNullable<ScmPrState['pr']>> = {}): NonNullable<ScmPrState['pr']> {
  return {
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    title: 'Panel PR',
    state: 'OPEN',
    isDraft: false,
    reviewDecision: null,
    baseRefName: 'main',
    headRefName: 'feature',
    mergeStateStatus: null,
    checks: { summary: 'none', items: [] },
    ...over,
  };
}

// UX wave U5b-2 (M10): the branch read's answers. A commit `n` hours old; its hash starts with `n` in four hexadecimal
// digits, so each short hash is its own (`0001bbb`).
export const shaOf = (n: number) => n.toString(16).padStart(4, '0') + 'b'.repeat(36);
export function branchCommitOf(n: number, pushed: boolean | null, over: Partial<GitBranchCommit> = {}): GitBranchCommit {
  const sha = shaOf(n);
  return { sha, shortSha: sha.slice(0, 7), author: 'Ada Example', authoredAt: new Date(Date.now() - n * 3_600_000).toISOString(), subject: `Change number ${n}`, parents: [shaOf(n + 1)], pushed, ...over };
}

// A branch of `all` commits since origin/main, the newest `notPushed` of them not pushed, read with the page's limit of 50.
export function branchCommitsOf({ all = 4, notPushed = 2, ...over }: Partial<GitBranchCommits> & { all?: number; notPushed?: number } = {}): GitBranchCommits {
  return {
    base: { ref: 'origin/main', mergeBase: shaOf(999) },
    upstream: 'origin/feature/x',
    commits: Array.from({ length: Math.min(all, 50) }, (_, i) => branchCommitOf(i + 1, i >= notPushed)),
    counts: { all, notPushed, pushed: all - notPushed },
    behind: 0,
    ...over,
  };
}
