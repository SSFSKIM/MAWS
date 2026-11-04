// Git's metadata read directly, before trust (P5 O7 M9, round 2): each answer is held against git's own over real
// repositories in a fake macOS home under a temp directory, and nothing a config names is followed. No test reads a
// real protected folder.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isolatedGitEnv } from '../../../test/support/git-env';
import { discoverRepo, GitLayoutError, guardedFiles, parseConfig, SetupReadRefused, worktreeList, type GitFiles } from './git-reads';
import type { Home } from './home-folders';

let home: string;
let mac: Home;
let files: GitFiles;

const git = (cwd: string, ...args: string[]) => execFileSync('/usr/bin/git', ['-C', cwd, ...args], { env: isolatedGitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const repo = (path: string) => {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  writeFileSync(join(path, 'README.md'), 'hello\n');
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'one');
  return path;
};
/** What git answers: the work tree, the common dir and the git dir, each its real path. */
const revParse = (directory: string) => {
  const [workTree, commonDir, gitDir] = git(directory, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--git-dir').trim().split('\n');
  return { workTree: realpathSync(workTree), commonDir: realpathSync(commonDir), gitDir: realpathSync(gitDir) };
};
const read = async (directory: string) => {
  const found = await discoverRepo(directory, files);
  return found === null ? null : { workTree: found.workTree, commonDir: found.commonDir, gitDir: found.gitDir };
};

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'git-reads-')));
  mac = { home, platform: 'darwin' };
  files = guardedFiles(mac, () => false);
  for (const dir of ['Documents', 'Developer']) mkdirSync(join(home, dir));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('a git config read as git reads it', () => {
  it('names and values each as `git config --list --no-includes` has them', () => {
    const text = [
      '﻿# a comment',
      '[core]',
      '\tbare = false ; trailing',
      '\tworktree',
      '\tName = "a ; b"   # comment',
      '[remote "Origin"]',
      '\turl = git@github.com:a/b.git',
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      '[Remote.Legacy]',
      '\tURL = one\\',
      'two',
      '[x "sub \\"q\\" \\\\ s"]',
      '\tk = " sp " mid\\ttab\\"q\\\\  ',
      '\tempty =',
      '[include]',
      '\tpath = /nowhere',
      '[includeIf "gitdir:/x/"]',
      '\tpath = /there',
      '',
    ].join('\n');
    const file = join(home, 'config');
    writeFileSync(file, text);
    const listed = git(home, 'config', '--file', file, '--no-includes', '--list', '-z').split('\0').filter((entry) => entry !== '');
    const expected = listed.map((entry) => {
      const newline = entry.indexOf('\n');
      return newline === -1 ? { name: entry, value: null } : { name: entry.slice(0, newline), value: entry.slice(newline + 1) };
    });
    expect(parseConfig(text).entries).toEqual(expected);
    const config = parseConfig(text);
    expect(config.get('remote.Origin.url')).toBe('git@github.com:a/b.git');
    expect(config.bool('core.worktree')).toBe(true); // a key with no value
    expect(config.bool('core.bare')).toBe(false);
    expect(config.get('include.path')).toBe('/nowhere'); // an entry like any other: nothing follows it
  });

  it('refuses a line git refuses', () => {
    expect(() => parseConfig('[core\n')).toThrow(GitLayoutError);
    expect(() => parseConfig('[core]\n\t=value\n')).toThrow(GitLayoutError);
    expect(() => parseConfig('[core]\n\tkey = "open\n')).toThrow(GitLayoutError);
  });
});

describe('a repository found from a folder as git finds it', () => {
  it('answers what `git rev-parse` does for a checkout, a folder in it, a linked worktree, a separate git dir and a submodule', async () => {
    const main = repo(join(home, 'Developer/main'));
    mkdirSync(join(main, 'src'));
    git(main, 'worktree', 'add', '-q', join(home, 'Developer/wt'));
    mkdirSync(join(home, 'Developer/wt/sub'));
    git(home, 'init', '-q', '--separate-git-dir', join(home, 'Developer/sep.git'), join(home, 'Developer/sepwt'));
    repo(join(home, 'Developer/lib'));
    git(main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', join(home, 'Developer/lib'), 'mod');
    for (const directory of [main, join(main, 'src'), join(home, 'Developer/wt'), join(home, 'Developer/wt/sub'), join(home, 'Developer/sepwt'), join(main, 'mod')]) {
      expect([directory, await read(directory)]).toEqual([directory, revParse(directory)]);
    }
  });

  it('answers no repository for a folder in none, no work tree for a bare repository or a folder inside a git dir', async () => {
    mkdirSync(join(home, 'Developer/plain'));
    expect(await read(join(home, 'Developer/plain'))).toBeNull();
    git(home, 'init', '-q', '--bare', join(home, 'Developer/bare.git'));
    expect(await read(join(home, 'Developer/bare.git'))).toMatchObject({ workTree: null, gitDir: join(home, 'Developer/bare.git') });
    const main = repo(join(home, 'Developer/main'));
    expect(await read(join(main, '.git/refs'))).toMatchObject({ workTree: null, gitDir: join(main, '.git') });
  });

  it('refuses a `.git` file git refuses', async () => {
    mkdirSync(join(home, 'Developer/odd'));
    writeFileSync(join(home, 'Developer/odd/.git'), 'nonsense\n');
    await expect(discoverRepo(join(home, 'Developer/odd'), files)).rejects.toThrow(GitLayoutError);
    writeFileSync(join(home, 'Developer/odd/.git'), 'gitdir: ../nowhere\n');
    await expect(discoverRepo(join(home, 'Developer/odd'), files)).rejects.toThrow(GitLayoutError);
  });

  it('never follows a config’s include, and refuses a pointer into an unopened protected folder', async () => {
    const main = repo(join(home, 'Developer/main'));
    writeFileSync(join(home, 'Documents/included'), '[core]\n\tbare = true\n');
    git(main, 'config', 'include.path', join(home, 'Documents/included'));
    expect(await read(main)).toEqual({ workTree: main, commonDir: join(main, '.git'), gitDir: join(main, '.git') });
    const real = repo(join(home, 'Documents/real'));
    mkdirSync(join(home, 'Developer/front'));
    symlinkSync(join(real, '.git'), join(home, 'Developer/front/.git'));
    await expect(discoverRepo(join(home, 'Developer/front'), files)).rejects.toEqual(new SetupReadRefused('protected', join(home, 'Developer/front/.git')));
    expect(await discoverRepo(join(home, 'Developer/front'), guardedFiles(mac, (folder) => folder === join(home, 'Documents')))).toMatchObject({ workTree: join(home, 'Developer/front'), gitDir: join(real, '.git') });
  });
});

describe('a repository’s worktrees as `git worktree list` has them', () => {
  const listed = (directory: string) => {
    const entries: { path: string; bare: boolean }[] = [];
    for (const line of git(directory, 'worktree', 'list', '--porcelain', '-z').split('\0')) {
      if (line.startsWith('worktree ')) entries.push({ path: line.slice('worktree '.length), bare: false });
      else if (line === 'bare') entries[entries.length - 1].bare = true;
    }
    return entries;
  };

  it('the main worktree first, then each linked one, from any of them', async () => {
    const main = repo(join(home, 'Developer/main'));
    git(main, 'worktree', 'add', '-q', join(home, 'Developer/wt-a'));
    git(main, 'worktree', 'add', '-q', join(home, 'Developer/wt-b'));
    for (const directory of [main, join(home, 'Developer/wt-a')]) {
      const found = await worktreeList((await discoverRepo(directory, files))!, files);
      expect(found[0]).toEqual(listed(directory)[0]);
      expect(new Set(found.slice(1).map((entry) => entry.path))).toEqual(new Set(listed(directory).slice(1).map((entry) => entry.path)));
    }
  });

  it('a bare common dir’s main worktree is bare; a `worktrees` linked into an unopened protected folder is refused before it is listed', async () => {
    git(home, 'init', '-q', '--bare', join(home, 'Developer/bare.git'));
    const bare = (await discoverRepo(join(home, 'Developer/bare.git'), files))!;
    expect((await worktreeList(bare, files))[0]).toEqual(listed(join(home, 'Developer/bare.git'))[0]);
    const main = repo(join(home, 'Developer/main'));
    mkdirSync(join(home, 'Documents/worktrees'));
    symlinkSync(join(home, 'Documents/worktrees'), join(main, '.git/worktrees'));
    await expect(worktreeList((await discoverRepo(main, files))!, files)).rejects.toBeInstanceOf(SetupReadRefused);
  });
});
