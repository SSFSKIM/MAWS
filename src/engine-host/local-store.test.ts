// The engine's canonical-root guards as the catalogue key sees them (P2-F wave S, S-catalogue review): 2.1.296 refuses
// a symbolic-link or special `commondir` or `gitdir` file in a worktree's admin directory and keeps the store at the
// worktree; its repository walk takes a `.git` symlink that resolves to a directory or file and walks past one that
// does not.
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localSettingsFiles } from './local-store';

let root: string;
const fifos: string[] = [];
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'maws-local-store-')));
});
afterEach(async () => {
  // a reader blocked on a FIFO (the unguarded read) is released by a writer's open and close
  for (const fifo of fifos.splice(0)) await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK).then((h) => h.close(), () => undefined);
  await rm(root, { recursive: true, force: true });
});

const write = async (file: string, text: string) => {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, text);
};
const store = (dir: string) => join(dir, '.claude', 'settings.local.json');

// a repository `main` with a linked worktree `wt` beside it, laid out as `git worktree add ../wt` writes it
const repository = async () => {
  const main = join(root, 'main');
  const wt = join(root, 'wt');
  const admin = join(main, '.git', 'worktrees', 'wt');
  await write(join(admin, 'commondir'), '../..\n');
  await write(join(admin, 'gitdir'), `${join(wt, '.git')}\n`);
  await write(join(wt, '.git'), `gitdir: ${admin}\n`);
  return { main, wt, admin };
};

describe('localSettingsFiles', () => {
  it("reads a linked worktree's store at its main checkout, over the worktree's own file", async () => {
    const { main, wt } = await repository();
    expect(await localSettingsFiles(wt, null)).toEqual([store(wt), store(main)]);
  });

  it("keeps the worktree's own store when the admin directory's commondir is a symbolic link", async () => {
    const { wt, admin } = await repository();
    await write(join(root, 'elsewhere', 'commondir'), '../..\n'); // the same text, reached through a link
    await rm(join(admin, 'commondir'));
    await symlink(join(root, 'elsewhere', 'commondir'), join(admin, 'commondir'));
    expect(await localSettingsFiles(wt, null)).toEqual([store(wt)]);
  });

  it("keeps the worktree's own store when the admin directory's gitdir is a symbolic link", async () => {
    const { wt, admin } = await repository();
    await write(join(root, 'elsewhere', 'gitdir'), `${join(wt, '.git')}\n`);
    await rm(join(admin, 'gitdir'));
    await symlink(join(root, 'elsewhere', 'gitdir'), join(admin, 'gitdir'));
    expect(await localSettingsFiles(wt, null)).toEqual([store(wt)]);
  });

  it("keeps the worktree's own store, without reading it, when commondir is a FIFO", async () => {
    const { wt, admin } = await repository();
    await rm(join(admin, 'commondir'));
    execFileSync('mkfifo', [join(admin, 'commondir')]);
    fifos.push(join(admin, 'commondir'));
    expect(await localSettingsFiles(wt, null)).toEqual([store(wt)]);
  }, 2000);

  it('takes a `.git` symlink to a directory as the repository root', async () => {
    const repo = join(root, 'repo');
    await mkdir(join(root, 'store.git'), { recursive: true });
    await mkdir(join(repo, 'sub'), { recursive: true });
    await symlink(join(root, 'store.git'), join(repo, '.git'));
    expect(await localSettingsFiles(join(repo, 'sub'), null)).toEqual([store(join(repo, 'sub')), store(repo)]);
  });

  it('walks past a `.git` entry that resolves to nothing, to the repository above', async () => {
    const repo = join(root, 'repo');
    const inner = join(repo, 'inner');
    await mkdir(join(repo, '.git'), { recursive: true });
    await mkdir(inner, { recursive: true });
    await symlink(join(root, 'nowhere'), join(inner, '.git'));
    expect(await localSettingsFiles(inner, null)).toEqual([store(inner), store(repo)]);
  });
});
