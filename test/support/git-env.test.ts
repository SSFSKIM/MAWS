import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createGitRunner, gitEnv } from '../../src/main/git/runner';
import { isolatedGitEnv } from './git-env';

// Oracle reads must honor the same global excludes as the product, but never inherited routing.
test('read oracle matches the app with global ignores and poisoned Git routing without changing the foreign repo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maws-git-oracle-'));
  try {
    const home = join(root, 'home');
    const repo = join(root, 'repo');
    const foreign = join(root, 'foreign');
    for (const dir of [home, repo, foreign]) mkdirSync(dir);
    const fixture = (cwd: string, ...args: string[]) => execFileSync('/usr/bin/git', args, { cwd, env: isolatedGitEnv(), encoding: 'utf8' });
    for (const dir of [repo, foreign]) fixture(dir, 'init', '--quiet');
    writeFileSync(join(home, '.gitconfig'), '[core]\n\texcludesFile = ~/.global-ignore\n');
    writeFileSync(join(home, '.global-ignore'), 'ignored.txt\n');
    writeFileSync(join(repo, 'ignored.txt'), 'globally ignored\n');
    writeFileSync(join(repo, 'visible.txt'), 'visible\n');
    writeFileSync(join(foreign, 'sentinel.txt'), 'foreign bytes\n');
    fixture(foreign, 'add', 'sentinel.txt');
    fixture(foreign, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'foreign sentinel');
    const snapshot = () => Object.fromEntries(readdirSync(foreign, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile()).map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [path, readFileSync(path).toString('base64')];
      }));
    const before = snapshot();
    const inherited = {
      ...process.env, HOME: home,
      GIT_DIR: join(foreign, '.git'), GIT_WORK_TREE: foreign, GIT_INDEX_FILE: join(foreign, '.git/index'),
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.excludesFile', GIT_CONFIG_VALUE_0: '/dev/null',
    };
    const args = ['status', '--porcelain', '--untracked-files=all'];
    const oracle = execFileSync('/usr/bin/git', args, { cwd: repo, env: gitEnv(inherited), encoding: 'utf8' });
    expect(oracle).toBe('?? visible.txt\n');
    expect(await createGitRunner({ env: inherited })(repo, args)).toBe(oracle);
    // The isolated mutation environment deliberately does not provide a valid live-read oracle.
    expect(fixture(repo, ...args)).toContain('?? ignored.txt');
    expect(snapshot()).toEqual(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
