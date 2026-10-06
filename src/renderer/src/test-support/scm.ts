// Source control tool tests (E6): a C4 status to vary per case, the answers `scm.*` gives, and main as the tool's body
// reads it (`scmMain`). Imported only by happy-dom suites.
import type { AppSessionId } from '@shared/graph/ids';
import type { GitDiff, GitFileStatus, GitStatus } from '@shared/ipc/schema/git';
import type { RemotePlan, ScmPrState, ScmRefusal, ScmStatus } from '@shared/ipc/schema/scm';
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

export const refusal = (refused: ScmRefusal['refused'], detail = '', output = ''): ScmRefusal => ({ refused, detail, output });

export const TOKEN = '6f1c2e0a-0000-4000-8000-000000000001';
export const OTHER_TOKEN = '6f1c2e0a-0000-4000-8000-000000000002';

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

// The body's scratch checkout (M3): an unstaged modification, a staged new file, an untracked file and an untracked
// directory, with the patches C4's `git.diff` answers for each scope.
export const scmFile = (path: string, index: string, worktree: string): GitFileStatus => ({ path, oldPath: null, index, worktree, untracked: false });
export const scmUntracked = (path: string): GitFileStatus => ({ path, oldPath: null, index: '?', worktree: '?', untracked: true });
export const SCRATCH_FILES: GitFileStatus[] = [scmFile('src/app.ts', '.', 'M'), scmFile('src/staged.ts', 'A', '.'), scmUntracked('untracked.txt'), scmUntracked('udir/')];
export const APP_PATCH = 'diff --git a/src/app.ts b/src/app.ts\nindex 1111111..2222222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n one\n+two\n three\n';
export const STAGED_PATCH = 'diff --git a/src/staged.ts b/src/staged.ts\nnew file mode 100644\nindex 0000000..3333333\n--- /dev/null\n+++ b/src/staged.ts\n@@ -0,0 +1 @@\n+export {};\n';
export const UNTRACKED_PATCH = 'diff --git a/untracked.txt b/untracked.txt\nnew file mode 100644\nindex 0000000..4444444\n--- /dev/null\n+++ b/untracked.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n';
const diffFile = (path: string, insertions: number, deletions = 0) => ({ path, oldPath: null, insertions, deletions, binary: false });

type ScmCommand =
  | 'scm.stage'
  | 'scm.unstage'
  | 'scm.discard'
  | 'scm.commit'
  | 'scm.status'
  | 'git.diff'
  // M4: the remote commands, the PR state, and the reads the PR sheet's title default makes
  | 'scm.push.plan'
  | 'scm.push'
  | 'scm.pr.plan'
  | 'scm.pr.create'
  | 'scm.remote.cancel'
  | 'scm.remote.last'
  | 'scm.pr.state'
  | 'git.log'
  | 'git.worktree.branch'
  | 'layout.openExternal';

// Main as the Source control body reads it: C4's watch and diffs over a scripted status, `scm.status`, and the four
// mutations (each `{ ok: true }` with the current status unless the case scripts an answer). `change` replaces the
// status and emits C4's `git.changed`, as the watcher's refresh after a mutation does.
export function scmMain(init: { status?: GitStatus; scm?: ScmStatus } = {}) {
  const state = {
    status: init.status ?? statusOf({ files: SCRATCH_FILES, ahead: 1 }),
    scm: init.scm ?? scmStatusOf(),
    watchError: null as string | null,
    diffs: {
      worktree: { patch: APP_PATCH, files: [diffFile('src/app.ts', 1)] },
      staged: { patch: STAGED_PATCH, files: [diffFile('src/staged.ts', 1)] },
    } as Record<'worktree' | 'staged', GitDiff>,
    untracked: new Map<string, string>([['untracked.txt', UNTRACKED_PATCH]]),
    fileDiffs: new Map<string, GitDiff>(), // one file of a staged or worktree scope, read alone past the scope's cap
    answers: {} as Partial<Record<ScmCommand, (input: Record<string, unknown>) => Answer | Promise<Answer>>>,
  };
  const fake = installFakeMain((name, input) => {
    switch (name) {
      case 'git.watch':
        return state.watchError !== null ? fail(state.watchError) : ok(state.status);
      case 'git.unwatch':
        return ok();
      case 'git.diff': {
        const scripted = state.answers['git.diff'];
        if (scripted) return scripted(input);
        const scope = input.scope as string;
        if (scope === 'untracked') {
          const patch = state.untracked.get(input.path as string);
          return patch === undefined ? fail(`not an untracked file: ${input.path as string}`) : ok({ patch, files: [diffFile(input.path as string, 2)] });
        }
        if (typeof input.path === 'string') {
          const one = state.fileDiffs.get(input.path);
          return one === undefined ? fail(`no file diff scripted for ${input.path}`) : ok(one);
        }
        return ok(scope === 'staged' ? state.diffs.staged : state.diffs.worktree);
      }
      case 'scm.status':
        return state.answers['scm.status']?.(input) ?? ok(state.scm);
      case 'scm.stage':
      case 'scm.unstage':
      case 'scm.discard':
      case 'scm.commit':
        return state.answers[name]?.(input) ?? ok({ ok: true, status: state.status, output: '' });
      // M4: no run held, no PR, and plans as main issues them for the scripted status unless a case scripts otherwise
      case 'scm.remote.last':
        return state.answers[name]?.(input) ?? ok(null);
      case 'scm.remote.cancel':
        return state.answers[name]?.(input) ?? ok();
      case 'scm.push.plan':
        return state.answers[name]?.(input) ?? ok(planOf());
      case 'scm.pr.plan':
        return state.answers[name]?.(input) ?? ok(prPlanOf());
      case 'scm.push':
      case 'scm.pr.create':
        return state.answers[name]?.(input) ?? ok({ started: true, token: input.token });
      case 'scm.pr.state':
        return state.answers[name]?.(input) ?? ok(prStateOf());
      case 'git.log':
        return state.answers[name]?.(input) ?? ok({ commits: [] });
      case 'git.worktree.branch':
        return state.answers[name]?.(input) ?? ok(null);
      case 'layout.openExternal':
        return state.answers[name]?.(input) ?? ok();
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

// The diff view measures text on a canvas, which happy-dom does not draw (as Review's suite stubs it).
export function stubCanvas(): void {
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (text: string) => ({ width: text.length * 7 }) })) as never;
}

export function planOf(over: Partial<RemotePlan> = {}): RemotePlan {
  return {
    token: TOKEN,
    kind: 'push',
    cwd: DIR,
    program: '/usr/bin/git',
    argv: ['push', '--progress', 'origin', 'refs/heads/main:refs/heads/main'],
    remote: 'origin',
    remoteUrl: 'https://github.com/o/r.git',
    pushUrls: ['https://github.com/o/r.git'],
    repository: null,
    branch: 'main',
    head: '0123456789abcdef0123456789abcdef01234567',
    upstream: 'origin/main',
    expiresAt: '2026-10-06T10:05:00.000Z',
    ...over,
  };
}

// A PR plan as main issues it for the scratch's `main` (M4): gh's repository bound with `--repo`.
export function prPlanOf(over: Partial<RemotePlan> = {}): RemotePlan {
  return planOf({
    kind: 'pr',
    program: '/opt/homebrew/bin/gh',
    argv: ['pr', 'create', '--repo', 'o/r', '--head', 'main', '--base', 'main', '--title=main', '--body='],
    repository: 'o/r',
    ...over,
  });
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
