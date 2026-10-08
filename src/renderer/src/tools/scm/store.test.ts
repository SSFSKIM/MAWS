// The Source control tool's data (E6 execution document, Design §1 and §5): the scope diffs held like Review's, the
// untracked file's diff on selection, the mutations that write only the tool's notice, and the latest remote run
// resumed from main's snapshot by sequence number. Main is a fake X2 bridge; the git patches the split reads are real.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { ScmRemoteOutput } from '@shared/ipc/schema/scm';
import { isolatedGitEnv } from '../../../../../test/support/git-env';
import { createClient } from '../../ipc/client';
import { queryClient } from '../../ipc/query';
import { createGitStore } from '../../stores/git';
import { fail, installFakeMain, ok, type Handler } from '../../test-support/code';
import { A, B, DIR, OTHER_TOKEN, planOf, refusal, statusOf, TOKEN } from '../../test-support/scm';
import { REVIEW_SCOPE_BYTES_CAP, splitPatch } from '../code/review/review-model';
import { prStateKey, scmStatusKey } from './queries';
import { connectScmRunEnds, createScmStore, diffOf, fileDiffOf, SCM_REFRESH_MS, type ScmDiffTarget } from './store';
import { createScmUi, forSession } from './view-state';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// The renderer's validating client over the fake, so every answer and event the cases script is held to its schema.
const validated = (bridge: MawsBridge) => createClient(() => bridge);

// ---- real git: the patches C4's service answers --------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'maws-scm-store-'));
function git(cwd: string, args: string[]): { stdout: string; status: number | null } {
  const result = spawnSync('/usr/bin/git', args, { cwd, env: isolatedGitEnv(), encoding: 'utf8' });
  return { stdout: result.stdout, status: result.status };
}
// `GitService.untrackedDiff`'s argv (src/main/git/service.ts), run from the top level.
const untrackedDiff = (cwd: string, path: string) =>
  git(cwd, ['-c', 'diff.autoRefreshIndex=false', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-index', '--src-prefix=a/', '--dst-prefix=b/', '-U3', '--', '/dev/null', path]);
// `GitService.diff`'s `worktree` scope.
const worktreeDiff = (cwd: string) => git(cwd, ['-c', 'diff.autoRefreshIndex=false', 'diff', '--no-relative', '--no-color', '--no-ext-diff', '--no-textconv', '-U3']);

let untrackedPatch = '';
let emptyPatch = '';
let conflictPatch = '';
beforeAll(() => {
  const repo = join(scratch, 'repo');
  git(scratch, ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  writeFileSync(join(repo, 'f.txt'), 'base\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'one']);
  git(repo, ['checkout', '-qb', 'side']);
  writeFileSync(join(repo, 'f.txt'), 'side\n');
  git(repo, ['commit', '-qam', 'side']);
  git(repo, ['checkout', '-q', 'main']);
  writeFileSync(join(repo, 'f.txt'), 'main\n');
  git(repo, ['commit', '-qam', 'main']);
  git(repo, ['merge', 'side']); // conflicts: f.txt is unmerged
  writeFileSync(join(repo, 'a.txt'), 'a\nmore\n'); // an ordinary unstaged change sorted before the conflict
  writeFileSync(join(repo, 'untracked.txt'), 'one\ntwo\n');
  writeFileSync(join(repo, 'empty.txt'), '');
  const listed = untrackedDiff(repo, 'untracked.txt');
  expect(listed.status).toBe(1);
  untrackedPatch = listed.stdout;
  emptyPatch = untrackedDiff(repo, 'empty.txt').stdout;
  conflictPatch = worktreeDiff(repo).stdout;
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('splitPatch on a real untracked patch (task 1’s deferred proof)', () => {
  it('reads the untracked scope’s header as an added file with its hunk', () => {
    expect(untrackedPatch.split('\n').slice(0, 5)).toEqual([
      'diff --git a/untracked.txt b/untracked.txt',
      'new file mode 100644',
      expect.stringMatching(/^index 0+\.\.[0-9a-f]+$/),
      '--- /dev/null',
      '+++ b/untracked.txt',
    ]);
    expect(splitPatch(untrackedPatch)).toEqual([
      { path: 'untracked.txt', oldPath: null, kind: 'added', hunks: ['@@ -0,0 +1,2 @@\n+one\n+two'], header: expect.stringContaining('new file mode') },
    ]);
  });

  it('reads an empty untracked file (a header and no hunk) as added', () => {
    expect(splitPatch(emptyPatch)).toEqual([{ path: 'empty.txt', oldPath: null, kind: 'added', hunks: [], header: expect.any(String) }]);
  });
});

// ---- the store over a fake main ------------------------------------------------------------------------------------

const APP_PATCH = 'diff --git a/src/app.ts b/src/app.ts\nindex 1..2 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n';
const APP_FILES = [{ path: 'src/app.ts', oldPath: null, insertions: 1, deletions: 1, binary: false }];
const STAGED: ScmDiffTarget = { directory: DIR, scope: 'staged' };
const WORKTREE: ScmDiffTarget = { directory: DIR, scope: 'worktree' };

function scmMain(extra: Handler = () => ok(), status: GitStatus = statusOf()) {
  return installFakeMain((name, input) => {
    if (name === 'git.diff') {
      if (input.scope === 'untracked') return ok({ patch: untrackedPatch, files: [{ path: input.path, oldPath: null, insertions: 2, deletions: 0, binary: false }] });
      return ok({ patch: APP_PATCH, files: APP_FILES });
    }
    if (name === 'git.watch') return ok(status);
    return extra(name, input);
  });
}

describe('source control store: diffs', () => {
  afterEach(() => vi.useRealTimers());

  it('reads one diff per (directory, scope) however many hold it, with the input each scope takes', async () => {
    const main = scmMain();
    const store = createScmStore(validated(main.bridge));
    const offs = [store.getState().hold(STAGED), store.getState().hold(STAGED), store.getState().hold(WORKTREE)];
    await tick();
    expect(main.callsOf('git.diff')).toEqual([
      { directory: DIR, scope: 'staged' },
      { directory: DIR, scope: 'worktree' },
    ]);
    const staged = diffOf(store.getState(), STAGED);
    expect(staged?.status === 'ok' && [...staged.patch!.keys()]).toEqual(['src/app.ts']);
    offs.forEach((off) => off());
    expect(diffOf(store.getState(), STAGED)).toBeUndefined();
    expect(store.getState().diffs.size).toBe(0);
  });

  it('fetches an untracked file’s diff only for the file a surface holds, and reads it as added', async () => {
    const main = scmMain();
    const store = createScmStore(validated(main.bridge));
    const offs = [store.getState().hold(STAGED), store.getState().hold(WORKTREE)];
    await tick();
    expect(main.callsOf('git.diff').filter((input) => input.scope === 'untracked')).toEqual([]);
    const target: ScmDiffTarget = { directory: DIR, scope: 'untracked', path: 'untracked.txt' };
    const off = store.getState().hold(target);
    await tick();
    expect(main.callsOf('git.diff').filter((input) => input.scope === 'untracked')).toEqual([{ directory: DIR, scope: 'untracked', path: 'untracked.txt' }]);
    const diff = diffOf(store.getState(), target);
    expect(diff?.status === 'ok' && diff.patch!.get('untracked.txt')).toMatchObject({ kind: 'added', hunks: ['@@ -0,0 +1,2 @@\n+one\n+two'] });
    store.getState().loadFile(target, 'untracked.txt'); // already whole: nothing to fetch
    await tick();
    expect(main.callsOf('git.diff')).toHaveLength(3);
    off();
    offs.forEach((o) => o());
  });

  // git writes an unmerged path's combined diff (`diff --cc`, `@@@` sections) before every `diff --git` block (probed on
  // 2.50.1 and 2.55.0), and the split drops what precedes the first block, so no conflict folds into a file's hunks.
  it('keeps a conflict’s combined diff out of the worktree scope’s files', async () => {
    expect(conflictPatch.split('\n').filter((line) => line.startsWith('diff '))).toEqual(['diff --cc f.txt', 'diff --git a/a.txt b/a.txt']);
    const main = installFakeMain((name) => (name === 'git.diff' ? ok({ patch: conflictPatch, files: [] }) : ok()));
    const store = createScmStore(validated(main.bridge));
    const off = store.getState().hold(WORKTREE);
    await tick();
    const diff = diffOf(store.getState(), WORKTREE);
    expect(diff?.status === 'ok' && [...diff.patch!.keys()]).toEqual(['a.txt']);
    expect(diff?.status === 'ok' && diff.patch!.get('a.txt')!.hunks).toEqual(['@@ -1 +1,2 @@\n a\n+more']);
    off();
  });

  it('re-reads every held diff of a directory 250 ms after the git store takes a new status for it', async () => {
    vi.useFakeTimers();
    const main = scmMain();
    const git = createGitStore(validated(main.bridge), { diffDelayMs: 10_000 });
    const store = createScmStore(validated(main.bridge), { git });
    const unwatch = git.getState().watch(DIR);
    const offs = [store.getState().hold(STAGED), store.getState().hold({ directory: DIR, scope: 'untracked', path: 'untracked.txt' }), store.getState().hold({ directory: '/other', scope: 'staged' })];
    const scmDiffs = () => main.callsOf('git.diff').filter((input) => input.scope !== 'all'); // the git store's own sum aside
    await vi.advanceTimersByTimeAsync(0);
    expect(scmDiffs()).toHaveLength(3);
    git.getState().applyChanged({ repoRoot: DIR, status: statusOf({ checkedAt: '2026-10-06T10:00:01.000Z' }), reason: 'index' });
    await vi.advanceTimersByTimeAsync(SCM_REFRESH_MS - 1);
    expect(scmDiffs()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(scmDiffs().slice(3)).toEqual([
      { directory: DIR, scope: 'staged' },
      { directory: DIR, scope: 'untracked', path: 'untracked.txt' },
    ]);
    offs.forEach((off) => off());
    unwatch();
  });

  it('past the scope cap keeps the file list only and fetches a file on selection', async () => {
    const main = installFakeMain((name, input) => {
      if (name !== 'git.diff') return ok();
      return ok({ patch: input.path ? APP_PATCH : APP_PATCH + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP), files: APP_FILES });
    });
    const store = createScmStore(validated(main.bridge));
    const off = store.getState().hold(WORKTREE);
    await tick();
    const diff = diffOf(store.getState(), WORKTREE);
    expect(diff?.status === 'ok' && diff.patch).toBeNull();
    store.getState().loadFile(WORKTREE, 'src/app.ts');
    store.getState().loadFile(WORKTREE, 'src/app.ts');
    await tick();
    expect(main.callsOf('git.diff').slice(1)).toEqual([{ directory: DIR, scope: 'worktree', path: 'src/app.ts' }]);
    expect(fileDiffOf(store.getState(), WORKTREE, 'src/app.ts')).toMatchObject({ status: 'ok', file: { path: 'src/app.ts', hunks: ['@@ -1 +1 @@\n-old\n+new'] } });
    off();
  });

  it('ignores a read released in flight once the scope is held again, and a file read of the released hold', async () => {
    const reads: ((patch: string) => void)[] = [];
    const main = installFakeMain(async (name, input) => {
      if (name !== 'git.diff') return ok();
      const patch = await new Promise<string>((resolve) => reads.push(resolve));
      return ok({ patch: input.path ? patch : patch + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP), files: APP_FILES });
    });
    const store = createScmStore(validated(main.bridge));
    const patch = (value: string) => `diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-before\n+${value}\n`;

    const first = store.getState().hold(WORKTREE);
    await tick();
    first(); // released with its read in flight
    const second = store.getState().hold(WORKTREE);
    await tick();
    reads[0](patch('first'));
    await tick();
    expect(diffOf(store.getState(), WORKTREE)).toEqual({ status: 'loading' }); // the released hold's answer is not this one's
    reads[1](patch('second'));
    await tick();
    expect(diffOf(store.getState(), WORKTREE)).toMatchObject({ status: 'ok', patch: null });

    store.getState().loadFile(WORKTREE, 'src/app.ts');
    await tick();
    second(); // released with the file read in flight
    const third = store.getState().hold(WORKTREE);
    await tick();
    reads[3](patch('third'));
    await tick();
    store.getState().loadFile(WORKTREE, 'src/app.ts');
    await tick();
    reads[2](patch('stale'));
    await tick();
    expect(fileDiffOf(store.getState(), WORKTREE, 'src/app.ts')).toEqual({ status: 'loading' });
    reads[4](patch('fresh'));
    await tick();
    expect(fileDiffOf(store.getState(), WORKTREE, 'src/app.ts')).toMatchObject({ status: 'ok', file: { hunks: ['@@ -1 +1 @@\n-before\n+fresh'] } });
    third();
  });

  // E11 (tracker row E6 "two short windows"): Stage moves the selection out of Untracked; a re-read asked before it and
  // answered after it says nothing about the file, so the "No diff for this entry" flash before git.changed is gone
  it('drops an untracked answer when a stage or discard of the file went out since the read was asked, and reads again after it', async () => {
    vi.useFakeTimers();
    const target: ScmDiffTarget = { directory: DIR, scope: 'untracked', path: 'untracked.txt' };
    const reads: ((answer: 'patch' | 'gone') => void)[] = [];
    const main = installFakeMain(async (name, input) => {
      if (name === 'scm.stage' || name === 'scm.discard') return ok({ ok: true, status: statusOf({ files: [] }), output: '' });
      if (name !== 'git.diff' || input.scope !== 'untracked') return ok();
      const answer = await new Promise<'patch' | 'gone'>((resolve) => reads.push(resolve));
      return answer === 'gone' ? fail(`not an untracked file: ${input.path}`) : ok({ patch: untrackedPatch, files: [{ path: input.path, oldPath: null, insertions: 2, deletions: 0, binary: false }] });
    });
    const store = createScmStore(validated(main.bridge));
    const ui = createScmUi({ session: A });
    const off = store.getState().hold(target);
    await vi.advanceTimersByTimeAsync(0);
    reads[0]('patch');
    await vi.advanceTimersByTimeAsync(0);
    expect(diffOf(store.getState(), target)).toMatchObject({ status: 'ok' });

    for (const [i, mutate] of [() => store.getState().stage(ui, A, ['untracked.txt']), () => store.getState().discard(ui, A, [{ path: 'untracked.txt', group: 'untracked' }])].entries()) {
      store.getState().statusChanged(DIR); // a re-read, in flight when the mutation goes out
      await vi.advanceTimersByTimeAsync(SCM_REFRESH_MS);
      await mutate();
      reads[1 + 2 * i]!('gone'); // main staged it first: C4 no longer lists it as untracked
      await vi.advanceTimersByTimeAsync(0);
      expect(diffOf(store.getState(), target), `${i}`).toMatchObject({ status: 'ok' }); // the earlier answer stands
      await vi.advanceTimersByTimeAsync(SCM_REFRESH_MS); // and the file is read again once the mutation answered
      expect(reads, `${i}`).toHaveLength(2 + 2 * i + 1);
      reads[2 + 2 * i]!('patch');
      await vi.advanceTimersByTimeAsync(0);
    }

    store.getState().statusChanged(DIR); // with no mutation since it was asked, a refusal is the answer
    await vi.advanceTimersByTimeAsync(SCM_REFRESH_MS);
    reads[5]!('gone');
    await vi.advanceTimersByTimeAsync(0);
    expect(diffOf(store.getState(), target)).toEqual({ status: 'error', message: 'not an untracked file: untracked.txt' });
    off();
  });

  it('says why a read failed', async () => {
    const main = installFakeMain((name) => (name === 'git.diff' ? fail('not an untracked file: udir/') : ok()));
    const store = createScmStore(validated(main.bridge));
    const target: ScmDiffTarget = { directory: DIR, scope: 'untracked', path: 'udir/' };
    const off = store.getState().hold(target);
    await tick();
    expect(diffOf(store.getState(), target)).toEqual({ status: 'error', message: 'not an untracked file: udir/' });
    off();
  });
});

describe('source control store applies no status of its own and resumes a run from the latest-run snapshot', () => {
  const committed = { ok: true, status: statusOf({ files: [] }), output: '[main abc1234] Fix\n', commit: { sha: 'abc1234def', subject: 'Fix' } } as const;

  it('stages and unstages with exactly the session and paths, clearing the notice and leaving the git store untouched', async () => {
    const main = scmMain((name) => (name === 'scm.stage' || name === 'scm.unstage' ? ok({ ok: true, status: statusOf({ files: [] }), output: '' }) : ok()));
    const git = createGitStore(validated(main.bridge));
    const store = createScmStore(validated(main.bridge), { git });
    const unwatch = git.getState().watch(DIR);
    await tick();
    const entries = git.getState().entries;
    const ui = createScmUi({ session: A });
    ui.setState({ notice: { kind: 'changed', text: 'stale', output: '' } });
    const result = await store.getState().stage(ui, A, ['src/app.ts', 'udir/']);
    expect(result).toMatchObject({ ok: true, value: { ok: true } });
    await store.getState().unstage(ui, A, ['src/app.ts']);
    expect(main.callsOf('scm.stage')).toEqual([{ appSessionId: A, paths: ['src/app.ts', 'udir/'] }]);
    expect(main.callsOf('scm.unstage')).toEqual([{ appSessionId: A, paths: ['src/app.ts'] }]);
    expect(ui.getState().notice).toBeNull();
    expect(git.getState().entries).toBe(entries); // the lists move when the watcher's git.changed arrives, not before
    unwatch();
  });

  it('shows a refusal with its output, and a failed call as an error', async () => {
    let answer = ok(refusal('git_failed', 'pre-commit hook failed', 'nope\n'));
    const main = scmMain(() => answer);
    const store = createScmStore(validated(main.bridge));
    const ui = createScmUi({ session: A });
    ui.setState({ message: 'Fix' });
    await store.getState().commit(ui, A);
    expect(ui.getState()).toMatchObject({ notice: { kind: 'git_failed', text: 'pre-commit hook failed', output: 'nope\n' }, message: 'Fix', lastCommit: null });
    answer = { ok: false, error: { code: 'timeout', message: 'git timed out' } };
    await store.getState().unstage(ui, A, ['a.ts']);
    expect(ui.getState().notice).toEqual({ kind: 'error', text: 'git timed out', output: '' });
    // E11 W-D: a discard's refusal or failure is its sheet's to show (the sheet stays open), not the notice behind it
    answer = ok(refusal('unmerged', '"a.ts" has a merge conflict'));
    ui.setState({ notice: null });
    await store.getState().discard(ui, A, [{ path: 'a.ts', group: 'unstaged' }]);
    expect(ui.getState().notice).toBeNull();
    expect(main.callsOf('scm.discard')).toEqual([{ appSessionId: A, entries: [{ path: 'a.ts', group: 'unstaged' }] }]);
  });

  it('commits the draft, then records the commit and clears the draft and Skip hooks', async () => {
    const main = scmMain((name) => (name === 'scm.commit' ? ok(committed) : ok()));
    const store = createScmStore(validated(main.bridge));
    const ui = createScmUi({ session: A });
    ui.setState({ message: 'Fix\n\nThe body.', noVerify: true, notice: { kind: 'nothing_staged', text: '', output: '' } });
    await store.getState().commit(ui, A);
    expect(main.callsOf('scm.commit')).toEqual([{ appSessionId: A, message: 'Fix\n\nThe body.', noVerify: true }]);
    expect(ui.getState()).toMatchObject({ lastCommit: { sha: 'abc1234def', subject: 'Fix' }, message: '', noVerify: false, notice: null });
  });

  it('keeps a draft edited while the commit ran', async () => {
    let release!: () => void;
    const main = scmMain(async (name) => {
      if (name !== 'scm.commit') return ok();
      await new Promise<void>((resolve) => (release = resolve));
      return ok(committed);
    });
    const store = createScmStore(validated(main.bridge));
    const ui = createScmUi({ session: A });
    ui.setState({ message: 'Fix' });
    const done = store.getState().commit(ui, A);
    await tick();
    ui.setState({ message: 'Fix, and the next one' });
    release();
    await done;
    expect(ui.getState()).toMatchObject({ lastCommit: { sha: 'abc1234def' }, message: 'Fix, and the next one' });
  });

  it('drops the committed draft a pinned tool parked for its session when the commit lands elsewhere', async () => {
    const releases: (() => void)[] = [];
    const main = scmMain(async (name) => {
      if (name !== 'scm.commit') return ok();
      await new Promise<void>((resolve) => releases.push(resolve));
      return ok(committed);
    });
    const store = createScmStore(validated(main.bridge));
    const ui = createScmUi({ session: A });
    ui.setState({ message: 'Fix', noVerify: true });
    const done = store.getState().commit(ui, A);
    await tick();
    ui.setState(forSession(ui.getState(), B));
    ui.setState({ message: 'B’s draft' });
    releases[0]();
    await done;
    expect(ui.getState()).toMatchObject({ session: B, message: 'B’s draft', lastCommit: null, notice: null });
    expect(ui.getState().drafts.has(A)).toBe(false);
    ui.setState(forSession(ui.getState(), A));
    expect(ui.getState()).toMatchObject({ session: A, message: '', noVerify: false });

    // A draft edited before the switch is not the one committed: it stays parked.
    ui.setState({ message: 'Next' });
    const again = store.getState().commit(ui, A);
    await tick();
    ui.setState({ message: 'Next, edited' });
    ui.setState(forSession(ui.getState(), B));
    releases[1]();
    await again;
    expect(ui.getState().drafts.get(A)).toEqual({ message: 'Next, edited', noVerify: false });
  });

  it('applies an answer only to the session it was asked for', async () => {
    let release!: () => void;
    const main = scmMain(async (name) => {
      if (name !== 'scm.stage') return ok();
      await new Promise<void>((resolve) => (release = resolve));
      return ok(refusal('untrusted', 'not trusted'));
    });
    const store = createScmStore(validated(main.bridge));
    const ui = createScmUi({ session: A });
    const done = store.getState().stage(ui, A, ['a.ts']);
    await tick();
    ui.setState({ session: B });
    release();
    await done;
    expect(ui.getState().notice).toBeNull();
  });

  const out = (seq: number, text: string, token = TOKEN): ScmRemoteOutput => ({ appSessionId: A, token, seq, kind: 'stdout', text });
  const exit = (seq: number, exitCode: number, token = TOKEN): ScmRemoteOutput => ({ appSessionId: A, token, seq, kind: 'exit', exitCode, signal: null });
  const snapshot = (over: Record<string, unknown> = {}) => ({
    token: TOKEN,
    kind: 'push',
    plan: planOf(),
    running: true,
    exitCode: null,
    signal: null,
    output: 'one\ntwo\nthree\n',
    truncated: false,
    seq: 3,
    startedAt: '2026-10-06T10:00:00.000Z',
    ...over,
  });

  it('seeds the run from scm.remote.last at seq 3, ignores events 1 to 3 and appends 4', async () => {
    const main = scmMain((name) => (name === 'scm.remote.last' ? ok(snapshot()) : ok()));
    const store = createScmStore(validated(main.bridge));
    const release = store.getState().resume(A);
    await tick();
    expect(main.callsOf('scm.remote.last')).toEqual([{ appSessionId: A }]);
    expect(store.getState().runs.get(A)).toMatchObject({ token: TOKEN, kind: 'push', plan: planOf(), running: true, seq: 3, lines: ['one', 'two', 'three', ''] });
    for (const seq of [1, 2, 3]) main.emit('scm.remote.output', out(seq, `again ${seq}\n`));
    main.emit('scm.remote.output', out(4, 'four\n'));
    main.emit('scm.remote.output', { ...out(5, 'B’s run\n', OTHER_TOKEN), appSessionId: B }); // another session's run
    main.emit('scm.remote.output', exit(5, 0));
    expect(store.getState().runs.get(A)).toMatchObject({ seq: 5, lines: ['one', 'two', 'three', 'four', ''], running: false, exitCode: 0 });
    release();
    expect(store.getState().runs.has(A)).toBe(false);
    main.emit('scm.remote.output', out(6, 'late\n'));
    expect(store.getState().runs.has(A)).toBe(false);
  });

  it('folds events that arrive before the snapshot by seq, and drops another run’s', async () => {
    let answer!: (value: unknown) => void;
    const main = scmMain(async (name) => (name === 'scm.remote.last' ? ok(await new Promise((resolve) => (answer = resolve))) : ok()));
    const store = createScmStore(validated(main.bridge));
    const release = store.getState().resume(A);
    await tick();
    main.emit('scm.remote.output', out(3, 'three\n')); // already folded into the snapshot
    main.emit('scm.remote.output', out(9, 'older run\n', OTHER_TOKEN)); // a run before the snapshot's
    main.emit('scm.remote.output', out(4, 'four\n'));
    answer(snapshot());
    await tick();
    expect(store.getState().runs.get(A)).toMatchObject({ token: TOKEN, seq: 4, lines: ['one', 'two', 'three', 'four', ''] });
    release();
  });

  it('takes a new run’s events once the held run has ended, never while it runs, and fills in the plan when the push answers', async () => {
    const main = scmMain((name) => (name === 'scm.remote.last' ? ok(null) : ok()));
    const store = createScmStore(validated(main.bridge));
    const release = store.getState().resume(A);
    await tick();
    expect(store.getState().runs.get(A)).toBeNull();
    main.emit('scm.remote.output', out(1, 'Enumerating objects: 3, done.\n')); // the push's first chunk before its answer
    expect(store.getState().runs.get(A)).toMatchObject({ token: TOKEN, plan: null, kind: null, running: true, seq: 1 });
    store.getState().started(A, planOf());
    expect(store.getState().runs.get(A)).toMatchObject({ token: TOKEN, plan: planOf(), kind: 'push', seq: 1, lines: ['Enumerating objects: 3, done.', ''] });
    main.emit('scm.remote.output', out(1, 'stale\n', OTHER_TOKEN)); // one run per checkout: not newer than a running one
    expect(store.getState().runs.get(A)).toMatchObject({ token: TOKEN });
    main.emit('scm.remote.output', exit(2, 0));
    const pr = planOf({ token: OTHER_TOKEN, kind: 'pr', program: '/opt/gh', argv: ['pr', 'create'] });
    store.getState().started(A, pr);
    expect(store.getState().runs.get(A)).toMatchObject({ token: OTHER_TOKEN, kind: 'pr', plan: pr, lines: [], seq: 0, running: true });
    main.emit('scm.remote.output', out(1, 'https://github.com/o/r/pull/7\n', OTHER_TOKEN));
    expect(store.getState().runs.get(A)).toMatchObject({ token: OTHER_TOKEN, lines: ['https://github.com/o/r/pull/7', ''] });
    release();
  });

  it('follows the run it holds from another session on the same checkout, and nothing else of that session', async () => {
    const main = scmMain((name) => (name === 'scm.remote.last' ? ok(snapshot()) : ok()));
    const store = createScmStore(validated(main.bridge));
    const release = store.getState().resume(B); // B's checkout's latest run is A's push
    await tick();
    expect(store.getState().runs.get(B)).toMatchObject({ token: TOKEN, seq: 3 });
    main.emit('scm.remote.output', out(4, 'four\n'));
    main.emit('scm.remote.output', exit(5, 0));
    expect(store.getState().runs.get(B)).toMatchObject({ seq: 5, lines: ['one', 'two', 'three', 'four', ''], running: false, exitCode: 0 });
    main.emit('scm.remote.output', out(1, 'A’s next run\n', OTHER_TOKEN)); // A's own, not the run B holds
    expect(store.getState().runs.get(B)).toMatchObject({ token: TOKEN, seq: 5 });
    release();
  });

  // One listener for the window's life (App.tsx's E6 block connects it), not one per mounted body: a run that ends while
  // no tool is shown still has every PR state asked again (E6 final review, finding 5).
  it('reads every PR state again when any run ends, mounted or not; output chunks and a disconnected listener do not', async () => {
    const main = scmMain();
    const client = validated(main.bridge);
    const prA = prStateKey(A);
    const prB = prStateKey(B);
    const statusA = scmStatusKey(A);
    queryClient.clear();
    for (const key of [prA, prB, statusA]) queryClient.setQueryData(key, {});
    const invalidated = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    const disconnect = connectScmRunEnds(client);
    main.emit('scm.remote.output', out(1, 'Enumerating objects\n'));
    expect([invalidated(prA), invalidated(prB)]).toEqual([false, false]);
    main.emit('scm.remote.output', exit(2, 0, OTHER_TOKEN)); // a run no store follows
    expect([invalidated(prA), invalidated(prB), invalidated(statusA)]).toEqual([true, true, false]);
    disconnect();
    for (const key of [prA, prB]) queryClient.setQueryData(key, {});
    main.emit('scm.remote.output', exit(3, 1));
    expect([invalidated(prA), invalidated(prB)]).toEqual([false, false]);
    queryClient.clear();
  });

  it('keeps another session’s events of the snapshot’s run that came before it, past its seq', async () => {
    let answer!: (value: unknown) => void;
    const main = scmMain(async (name) => (name === 'scm.remote.last' ? ok(await new Promise((resolve) => (answer = resolve))) : ok()));
    const store = createScmStore(validated(main.bridge));
    const release = store.getState().resume(B);
    await tick();
    main.emit('scm.remote.output', out(4, 'four\n'));
    main.emit('scm.remote.output', out(1, 'unrelated\n', OTHER_TOKEN));
    answer(snapshot());
    await tick();
    expect(store.getState().runs.get(B)).toMatchObject({ token: TOKEN, seq: 4, lines: ['one', 'two', 'three', 'four', ''] });
    release();
  });
});
