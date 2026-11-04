// A remote setup's reads before trust answer what git's would (P5 O7 M9, round 2): the trust key read from git's files
// is the one `git rev-parse` gives, and the project fold read from them is the one `git worktree list` and the index
// give, over real repositories of each layout in a fake macOS home under a temp directory.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardedFiles } from '@shared/machine/git-reads';
import { isolatedGitEnv } from '../../../test/support/git-env';
import { createGitRunner } from '../git/runner';
import { locate, mainWorktree, warmLinkedWorktreeRead } from '../index/projects';
import { trustKeyOf } from '../sessions/trust';
import { setupRepoDirs } from './setup';

let home: string;
const git = (cwd: string, ...args: string[]) => execFileSync('/usr/bin/git', ['-C', cwd, ...args], { env: isolatedGitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const repo = (path: string) => {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  writeFileSync(join(path, 'README.md'), 'hello\n');
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'one');
  return path;
};
const at = (path: string) => join(home, 'Developer', path);
const directories: string[] = [];

beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'setup-git-')));
  mkdirSync(join(home, 'Developer'));
  const main = repo(at('main'));
  mkdirSync(join(main, 'src'));
  git(main, 'worktree', 'add', '-q', at('wt'));
  git(repo(at('other')), 'worktree', 'add', '-q', at('edited'));
  repo(at('lib'));
  git(main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', at('lib'), 'mod');
  mkdirSync(at('sep'));
  git(home, 'init', '-q', '--separate-git-dir', at('sep/.git'), at('sepwt'));
  writeFileSync(at('sepwt/README.md'), 'sep\n');
  git(at('sepwt'), 'add', '.');
  git(at('sepwt'), 'commit', '-q', '-m', 'one');
  git(at('sepwt'), 'worktree', 'add', '-q', at('sep-linked'));
  git(home, 'clone', '-q', '--bare', main, at('bare.git'));
  git(at('bare.git'), 'worktree', 'add', '-q', at('bare-linked'));
  mkdirSync(at('plain'));
  // the review's case: a `core.worktree` with a TAB in it, beside a decoy spelled with a space
  mkdirSync(at('one\ttwo'));
  mkdirSync(at('one two'));
  git(home, 'init', '-q', '--separate-git-dir', at('tab.git'), at('one\ttwo'));
  appendFileSync(at('tab.git/config'), '[core]\n\tworktree = ../one\ttwo\n'); // a literal TAB (`git config` would write `\\t`)
  directories.push(at('one\ttwo'), main, join(main, 'src'), at('wt'), at('edited'), join(main, 'mod'), at('sepwt'), at('sep-linked'), at('bare-linked'), at('plain'));
  writeFileSync(at('other/README.md'), 'edited in the main checkout\n'); // `edited`'s main no longer holds HEAD's bytes
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

const files = () => guardedFiles({ home, platform: 'darwin' }, () => false);

describe('a remote setup’s reads before trust', () => {
  it('key each folder’s trust as git does', async () => {
    const run = createGitRunner({ env: { PATH: process.env.PATH, HOME: home } });
    for (const directory of directories) {
      expect([directory, await trustKeyOf(directory, run, setupRepoDirs(files()))]).toEqual([directory, await trustKeyOf(directory, run)]);
    }
    await expect(trustKeyOf(at('bare.git'), run, setupRepoDirs(files()))).rejects.toThrow(/no work tree/);
    await expect(trustKeyOf(at('bare.git'), run)).rejects.toThrow();
  });

  it('fold each folder into the project git’s listing and content check would', async () => {
    const candidates: Record<string, string | null> = { [at('wt')]: at('wt'), [at('edited')]: at('edited'), [at('sep-linked')]: at('sep-linked'), [at('bare-linked')]: at('bare-linked'), [join(home, 'Developer/main/mod')]: join(home, 'Developer/main/mod') };
    for (const directory of directories) {
      const root = candidates[directory] ?? null;
      const expected = root === null ? null : mainWorktree(root);
      await warmLinkedWorktreeRead(directory, files());
      const located = locate(directory, () => {
        throw new Error('the warmed answer asks no git');
      });
      expect([directory, located.projectDirectory]).toEqual([directory, expected ?? directory]);
    }
    expect(mainWorktree(at('wt'))).toBe(at('main')); // the layouts exercise a fold, and each refusal of one
    expect(mainWorktree(at('edited'))).toBeNull();
  });
});
