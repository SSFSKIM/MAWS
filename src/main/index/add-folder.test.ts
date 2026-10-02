import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScratchRepo } from '../../../test/support/scratch-repo';
import { tempDir } from '../../../test/support/index-fixture';
import { addFolder } from './add-folder';
import { Index } from './index';

// New chat's "New project" (2026-10-01): the picked folder becomes a project by the membership rule.
describe('a folder picked as a New project', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let repo: ScratchRepo | null = null;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
  });
  afterEach(() => {
    index.close();
    dir.dispose();
    repo?.fixture.dispose();
    repo = null;
  });

  it('is a project of its own, chosen at its directory, and the same folder again is the same project made visible', () => {
    const folder = join(dir.path, 'plain');
    mkdirSync(folder);
    const first = addFolder(index.projects, folder);
    expect(first.location).toEqual({ kind: 'directory', path: folder });
    expect(first.project).toMatchObject({ directory: folder, name: 'plain' });
    index.projects.hide(first.project.id);
    expect(index.projects.list()).toEqual([]);
    const again = addFolder(index.projects, `${folder}/`);
    expect(again.project.id).toBe(first.project.id);
    expect(index.projects.list().map((p) => p.id)).toEqual([first.project.id]);
  });

  it('folds a managed worktree under its checkout’s project, chosen as that existing worktree', async () => {
    repo = await ScratchRepo.create({ sentinels: false });
    const worktree = await repo.addManagedWorktree('side');
    const { project, location } = addFolder(index.projects, worktree);
    expect(project.directory).toBe(repo.root);
    expect(location).toEqual({ kind: 'existingWorktree', repoRoot: repo.root, path: worktree });
    expect(index.projects.list().map((p) => p.directory)).toEqual([repo.root]);
  });

  it('runs in a folder inside a worktree where it was picked, under the checkout’s project', async () => {
    repo = await ScratchRepo.create({ sentinels: false });
    const worktree = await repo.addManagedWorktree('side');
    const inside = join(worktree, 'pkg');
    mkdirSync(inside);
    const { project, location } = addFolder(index.projects, inside);
    expect(project.directory).toBe(repo.root);
    expect(location).toEqual({ kind: 'directory', path: inside });
  });

  it('refuses what is not a directory', () => {
    const file = join(dir.path, 'a-file');
    writeFileSync(file, '');
    expect(() => addFolder(index.projects, file)).toThrow(`not a directory: ${file}`);
    expect(() => addFolder(index.projects, join(dir.path, 'missing'))).toThrow('not a directory');
    expect(index.projects.list()).toEqual([]);
  });
});
