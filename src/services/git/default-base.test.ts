// The default-branch rule (UX wave U5b-2, Interfaces §C, decision 13) over scratch repositories the fixture makes: the
// remote it picks, the base ref's five steps each with the earlier ones absent, and the cases that have no base. Remote
// refs are written with `update-ref`, as a fetch would leave them; nothing here reaches a network.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitFixture } from '../../../test/support/git-fixture';
import { defaultBase, defaultRemote, remoteHeadBranch } from './default-base';
import { createGitRunner, type GitRun } from './runner';

describe('the default-branch rule', () => {
  let repo: GitFixture;
  let run: GitRun;
  let initial: string;
  beforeEach(async () => {
    repo = await GitFixture.create();
    run = createGitRunner({ env: repo.serviceEnv() });
    initial = (await repo.git('rev-parse', 'HEAD')).trim();
  });
  afterEach(() => repo.dispose());

  const head = async () => (await repo.git('rev-parse', 'HEAD')).trim();
  async function commit(message: string): Promise<string> {
    await repo.write(`${message}.txt`, `${message}\n`);
    await repo.git('add', `${message}.txt`);
    await repo.git('commit', '-q', '-m', message);
    return head();
  }
  // A commit made off to the side (its parent `parent`), for a remote ref to point at; the work tree is not touched.
  async function sideCommit(parent: string, message: string): Promise<string> {
    const tree = (await repo.git('rev-parse', `${parent}^{tree}`)).trim();
    return (await repo.git('commit-tree', tree, '-p', parent, '-m', message)).trim();
  }
  const remote = (name: string) => repo.git('remote', 'add', name, `https://example.invalid/${name}.git`);
  const ref = (name: string, sha: string) => repo.git('update-ref', name, sha);
  const drop = (name: string) => repo.git('update-ref', '-d', name);

  it('takes the base ref by its five steps, each answering when the earlier ones are absent', async () => {
    await remote('origin');
    const [trunk, main, master] = [await sideCommit(initial, 'trunk'), await sideCommit(initial, 'main'), await sideCommit(initial, 'master')];
    await ref('refs/remotes/origin/trunk', trunk);
    await ref('refs/remotes/origin/main', main);
    await ref('refs/remotes/origin/master', master);
    await repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    await repo.git('branch', '-q', 'master');
    await repo.git('checkout', '-q', '-b', 'feature');
    await commit('feature work');

    expect(await defaultBase(run, repo.root)).toEqual({ ref: 'origin/trunk', commit: trunk, mergeBase: initial }); // the remote's HEAD branch
    await repo.git('symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
    expect(await defaultBase(run, repo.root)).toMatchObject({ ref: 'origin/main', commit: main });
    await drop('refs/remotes/origin/main');
    expect(await defaultBase(run, repo.root)).toMatchObject({ ref: 'origin/master', commit: master });
    await drop('refs/remotes/origin/master');
    expect(await defaultBase(run, repo.root)).toEqual({ ref: 'main', commit: initial, mergeBase: initial }); // local main
    await repo.git('branch', '-q', '-D', 'main');
    expect(await defaultBase(run, repo.root)).toMatchObject({ ref: 'master', mergeBase: initial }); // local master
    await repo.git('branch', '-q', '-D', 'master');
    expect(await defaultBase(run, repo.root)).toBeNull();
  });

  it('passes over a remote HEAD whose branch is gone, and a name that only begins like a candidate', async () => {
    await remote('origin');
    const main = await sideCommit(initial, 'main');
    await ref('refs/remotes/origin/main', main);
    await ref('refs/remotes/origin/master/old', await sideCommit(initial, 'nested')); // `refs/remotes/origin/master` is not this
    await repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/gone');
    expect(await defaultBase(run, repo.root)).toMatchObject({ ref: 'origin/main', commit: main });
    await drop('refs/remotes/origin/main');
    await repo.git('checkout', '-q', '-b', 'feature');
    expect(await defaultBase(run, repo.root)).toMatchObject({ ref: 'main' }); // not origin/master/old
  });

  it('reads the branch\'s upstream remote, else origin, else the only remote', async () => {
    await remote('fork');
    await ref('refs/remotes/fork/main', await sideCommit(initial, 'fork main'));
    await repo.git('checkout', '-q', '-b', 'feature');
    expect(await defaultBase(run, repo.root)).toMatchObject({ ref: 'fork/main' }); // the only remote
    await remote('origin');
    await ref('refs/remotes/origin/main', await sideCommit(initial, 'origin main'));
    expect(await defaultBase(run, repo.root)).toMatchObject({ ref: 'origin/main' }); // origin, among two
    await ref('refs/remotes/fork/feature', await head());
    await repo.git('branch', '-q', '--set-upstream-to=fork/feature');
    expect(await defaultBase(run, repo.root)).toMatchObject({ ref: 'fork/main' }); // the upstream's remote
    expect(await defaultRemote(run, repo.root, ['fork', 'origin'])).toBe('fork');
  });

  it('answers the default branch\'s remote copy when HEAD is on it, and no base without one', async () => {
    expect(await defaultBase(run, repo.root)).toBeNull(); // HEAD on main, no remote copy
    await remote('origin');
    await ref('refs/remotes/origin/main', initial);
    await commit('local only');
    expect(await defaultBase(run, repo.root)).toEqual({ ref: 'origin/main', commit: initial, mergeBase: initial });
  });

  it('answers a worktree the base its main checkout answers, whichever branch the main checkout is on', async () => {
    await remote('origin');
    const main = await sideCommit(initial, 'main');
    await ref('refs/remotes/origin/main', main);
    const worktree = await repo.addWorktree('wt');
    await repo.git('checkout', '-q', '-b', 'elsewhere');
    await commit('elsewhere');
    expect(await defaultBase(run, worktree)).toEqual(await defaultBase(run, repo.root));
    expect(await defaultBase(run, worktree)).toMatchObject({ ref: 'origin/main', mergeBase: initial });
  });

  it('compares a detached HEAD like any other', async () => {
    await commit('second');
    await repo.git('checkout', '-q', '--detach', 'HEAD');
    await commit('detached');
    expect(await defaultBase(run, repo.root)).toMatchObject({ ref: 'main', mergeBase: (await repo.git('rev-parse', 'main')).trim() });
  });

  it('has no base for a branch that shares no commit with it, nor before the first commit', async () => {
    await repo.git('checkout', '-q', '--orphan', 'unrelated');
    expect(await defaultBase(run, repo.root)).toBeNull(); // no commit on HEAD yet
    await repo.git('commit', '-q', '--allow-empty', '-m', 'unrelated root');
    expect(await defaultBase(run, repo.root)).toBeNull(); // main shares nothing with it
  });

  it('keeps the scm service\'s two steps: the remote\'s HEAD branch by its full ref, none when git knows none', async () => {
    await remote('origin');
    expect(await remoteHeadBranch(run, repo.root, 'origin')).toBeNull();
    await ref('refs/remotes/origin/develop', initial);
    await repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    expect(await remoteHeadBranch(run, repo.root, 'origin')).toBe('develop');
  });
});
