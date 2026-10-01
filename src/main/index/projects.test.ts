import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectId } from '@shared/graph/ids';
import { ProjectRecordSchema } from '@shared/ipc/schema/session';
import { runGit } from '../../../test/support/git-fixture';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';
import { locate, mainWorktree } from './projects';

describe('projects and the membership rule', () => {
  let dir: ReturnType<typeof tempDir>;
  let tree: ReturnType<typeof tempDir>;
  let index: Index;
  let projectChanges: number;
  beforeEach(() => {
    dir = tempDir();
    tree = tempDir('maws-projects-');
    index = new Index(join(dir.path, 'index.sqlite'));
    projectChanges = 0;
    index.projects.onChange(() => (projectChanges += 1));
  });
  afterEach(() => {
    index.close();
    dir.dispose();
    tree.dispose();
  });

  // `origin` stays behind the ProjectRecord; the test reads it from the file, as acceptance item 7 does with sqlite3.
  const originOf = (id: string) => {
    const db = new DatabaseSync(join(dir.path, 'index.sqlite'), { readOnly: true });
    try {
      return (db.prepare('SELECT origin FROM projects WHERE id = ?').get(id) as { origin: string }).origin;
    } finally {
      db.close();
    }
  };

  const repo = (name: string) => {
    const path = join(tree.path, name);
    mkdirSync(path, { recursive: true });
    return path;
  };

  it('discovery auto-creates a project for an existing directory with a session that has messages, named by its basename', () => {
    const directory = repo('alpha');
    const { record } = index.sessions.upsertFromSummary(summary({ directory }));
    const projects = index.projects.list();
    expect(projects).toEqual([{ id: expect.any(String), name: 'alpha', directory, order: 0, createdAt: expect.any(String) }]);
    expect(record.projectId).toBe(projects[0].id);
    expect(record.directory).toBe(directory);
    expect(projectChanges).toBe(1);

    // A second session there joins it; one without messages elsewhere creates nothing.
    const other = repo('beta');
    expect(index.sessions.upsertFromSummary(summary({ directory })).record.projectId).toBe(projects[0].id);
    expect(index.sessions.upsertFromSummary(summary({ directory: other, hasMessages: false })).record.projectId).toBeNull();
    expect(index.projects.list()).toHaveLength(1);
  });

  it('a ProjectRecord projected from a row has exactly C5\'s five fields', () => {
    index.sessions.upsertFromSummary(summary({ directory: repo('alpha') }));
    const [project] = index.projects.list();
    expect(Object.keys(project).sort()).toEqual(['createdAt', 'directory', 'id', 'name', 'order']);
    expect(ProjectRecordSchema.parse(project)).toEqual(project);
  });

  it('a session in <project>/.claude/worktrees/<name> joins that project with worktree.path set and the branch from the summary', () => {
    const directory = repo('alpha');
    const worktree = join(directory, '.claude/worktrees/wt');
    mkdirSync(join(worktree, 'src'), { recursive: true });
    const main = index.sessions.upsertFromSummary(summary({ directory })).record;
    const inTree = index.sessions.upsertFromSummary(summary({ directory: join(worktree, 'src'), gitBranch: 'wt' })).record;
    expect(inTree.projectId).toBe(main.projectId);
    expect(inTree.worktree).toEqual({ path: worktree, branch: 'wt' });
    expect(index.projects.list()).toHaveLength(1);
    expect(index.projects.resolveMembership(worktree)).toEqual({ projectId: main.projectId, worktree: { path: worktree, branch: null } });
  });

  it('a relocated session belongs where it was relocated to', () => {
    const from = repo('old');
    const to = repo('new');
    const { record } = index.sessions.upsertFromSummary(summary({ directory: from, relocatedCwd: to }));
    expect(record.directory).toBe(to);
    expect(index.projects.list().map((p) => p.directory)).toEqual([to]);
  });

  it('a summary whose directory does not exist gets projectId null and creates no project', () => {
    const { record } = index.sessions.upsertFromSummary(summary({ directory: join(tree.path, 'gone') }));
    expect(record.projectId).toBeNull();
    expect(index.projects.list({ includeHidden: true })).toEqual([]);
  });

  it('a realpathed directory: a session run through a symlink joins the project of its target', () => {
    const directory = repo('alpha');
    symlinkSync(directory, join(tree.path, 'link'));
    const direct = index.sessions.upsertFromSummary(summary({ directory })).record;
    const viaLink = index.sessions.upsertFromSummary(summary({ directory: join(tree.path, 'link') })).record;
    expect(viaLink.directory).toBe(directory);
    expect(viaLink.projectId).toBe(direct.projectId);
    expect(index.projects.list()).toHaveLength(1);
  });

  it('session.projects.remove hides the project; rediscovery leaves it hidden and the session attached to it', () => {
    const directory = repo('alpha');
    const s = summary({ directory });
    const { record } = index.sessions.upsertFromSummary(s);
    const projectId = record.projectId!;
    index.projects.hide(projectId);
    expect(index.projects.list()).toEqual([]);
    const again = index.sessions.upsertFromSummary({ ...s, size: 999, lastRecordAt: '2026-09-28T11:00:00.000Z' });
    expect(again.record.projectId).toBe(projectId);
    expect(index.projects.list()).toEqual([]);
    expect(index.projects.list({ includeHidden: true }).map((p) => p.id)).toEqual([projectId]);
  });

  it('add realpaths an existing directory as origin user, attaches the sessions already there, and brings a hidden project back', () => {
    const directory = repo('alpha');
    const orphan = index.sessions.upsertFromSummary(summary({ directory, hasMessages: false })).record;
    expect(orphan.projectId).toBeNull();
    const added = index.projects.add(join(directory, '..', 'alpha'));
    expect(added).toMatchObject({ name: 'alpha', directory });
    expect(originOf(added.id)).toBe('user');
    expect(index.sessions.get(orphan.appId)?.projectId).toBe(added.id);

    index.projects.hide(added.id);
    expect(index.projects.add(directory).id).toBe(added.id);
    expect(index.projects.list().map((p) => p.id)).toEqual([added.id]);
    expect(() => index.projects.add(join(tree.path, 'missing'))).toThrow('not a directory');
  });

  it('a user add of a discovered project makes it the user\'s', () => {
    const directory = repo('alpha');
    const { record } = index.sessions.upsertFromSummary(summary({ directory }));
    expect(originOf(record.projectId!)).toBe('discovered');
    expect(index.projects.add(directory).id).toBe(record.projectId);
    expect(originOf(record.projectId!)).toBe('user');
  });

  describe('linked git worktrees (Decision Log, 2026-10-01)', () => {
    // A main checkout with one commit, in the test's own tree (git's isolated fixture environment, never a real repo).
    const checkout = async (name: string) => {
      const path = repo(name);
      await runGit(path, ['init', '-q', '-b', 'main']);
      writeFileSync(join(path, 'README.md'), 'hello\n');
      await runGit(path, ['add', 'README.md']);
      await runGit(path, ['commit', '-q', '-m', 'initial']);
      return path;
    };
    // The real git question, counted per root.
    const counted = () => {
      const roots: string[] = [];
      return { roots, mainWorktreeOf: (root: string) => (roots.push(root), mainWorktree(root)) };
    };
    // A checkout like `checkout`, but whose git dir is `gitDir` (git init --separate-git-dir), with a linked worktree.
    const separated = async (name: string, gitDir: string) => {
      const path = repo(name);
      await runGit(path, ['init', '-q', '-b', 'main', `--separate-git-dir=${gitDir}`]);
      writeFileSync(join(path, 'README.md'), 'hello\n');
      await runGit(path, ['add', 'README.md']);
      await runGit(path, ['commit', '-q', '-m', 'initial']);
      await runGit(path, ['worktree', 'add', '-q', `../${name}-linked`, '-b', 'feature']);
      return { path, linked: join(tree.path, `${name}-linked`) };
    };
    const unfolded = (directory: string) => ({ realpath: directory, projectDirectory: directory, worktreePath: null });

    it('a sibling linked worktree (git worktree add ../sibling) belongs to the main checkout, its root the worktree, from any directory inside it', async () => {
      const main = await checkout('main');
      await runGit(main, ['worktree', 'add', '-q', '../sibling', '-b', 'feature']);
      const sibling = join(tree.path, 'sibling');
      mkdirSync(join(sibling, 'src/deep'), { recursive: true });
      expect(locate(sibling)).toEqual({ realpath: sibling, projectDirectory: main, worktreePath: sibling });
      expect(locate(join(sibling, 'src/deep'))).toEqual({ realpath: join(sibling, 'src/deep'), projectDirectory: main, worktreePath: sibling });

      // A managed worktree the engine made inside the linked one belongs to the main checkout too.
      await runGit(sibling, ['worktree', 'add', '-q', '.claude/worktrees/wt', '-b', 'wt']);
      const managed = join(sibling, '.claude/worktrees/wt');
      expect(locate(managed)).toEqual({ realpath: managed, projectDirectory: main, worktreePath: managed });

      // Discovery files a session there under the main checkout's project, with the worktree and its branch.
      const inMain = index.sessions.upsertFromSummary(summary({ directory: main })).record;
      const inSibling = index.sessions.upsertFromSummary(summary({ directory: join(sibling, 'src'), gitBranch: 'feature' })).record;
      expect(inSibling.projectId).toBe(inMain.projectId);
      expect(inSibling.worktree).toEqual({ path: sibling, branch: 'feature' });
      expect(index.projects.list().map((p) => p.directory)).toEqual([main]);
      expect(index.projects.resolveMembership(sibling)).toEqual({ projectId: inMain.projectId, worktree: { path: sibling, branch: null } });

      // An explicit add still registers the directory it is given.
      expect(index.projects.add(sibling).directory).toBe(sibling);
    });

    it('a main checkout, a directory inside it and a plain directory do not fold, and need no git call', async () => {
      const main = await checkout('main');
      mkdirSync(join(main, 'src'));
      const plain = repo('plain');
      const { roots, mainWorktreeOf } = counted();
      expect(locate(main, mainWorktreeOf)).toEqual({ realpath: main, projectDirectory: main, worktreePath: null });
      expect(locate(join(main, 'src'), mainWorktreeOf)).toEqual({ realpath: join(main, 'src'), projectDirectory: join(main, 'src'), worktreePath: null });
      expect(locate(plain, mainWorktreeOf)).toEqual({ realpath: plain, projectDirectory: plain, worktreePath: null });
      expect(roots).toEqual([]);
    });

    // Git names a repository's main worktree by its common dir (that dir's parent when it is named `.git`), whatever
    // the checkout really is; none of these may fold under a directory that is not the checkout.
    it('a .git file of no linked checkout worktree does not fold: a checkout with a separate git dir, a submodule, a bare repository\'s worktrees', async () => {
      const separate = repo('separate');
      await runGit(separate, ['init', '-q', '-b', 'main', `--separate-git-dir=${join(repo('store'), '.git')}`]);
      const main = await checkout('main');
      const library = await checkout('library');
      await runGit(main, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', library, 'sub']);
      const submodule = join(main, 'sub'); // git lists its main worktree as main/.git/modules/sub
      // A bare repository, and one named `.git` (git names its parent as the main worktree, marked bare).
      await runGit(tree.path, ['clone', '-q', '--bare', main, 'bare.git']);
      await runGit(join(tree.path, 'bare.git'), ['worktree', 'add', '-q', '../bare-wt', '-b', 'feature']);
      await runGit(tree.path, ['clone', '-q', '--bare', main, 'bare-home/.git']);
      await runGit(join(tree.path, 'bare-home/.git'), ['worktree', 'add', '-q', '../../bare-home-wt', '-b', 'feature']);
      const bareWorktrees = [join(tree.path, 'bare-wt'), join(tree.path, 'bare-home-wt')];

      const { roots, mainWorktreeOf } = counted();
      expect(locate(separate, mainWorktreeOf)).toEqual(unfolded(separate));
      expect(locate(submodule, mainWorktreeOf)).toEqual(unfolded(submodule));
      for (const worktree of bareWorktrees) expect(locate(worktree, mainWorktreeOf)).toEqual(unfolded(worktree));
      expect(roots).toEqual([separate, submodule, ...bareWorktrees]); // each was a candidate: its `.git` is a file
    });

    // A checkout made with `git init --separate-git-dir` is recorded nowhere in its git dir, so git names the git dir
    // (or, for one named `.git`, its parent) as the main worktree. Its linked worktrees stay directories of their own:
    // folding them under that directory would file their sessions there, and the start-up refold would hide the project
    // they had.
    it('a linked worktree of a checkout with a separate git dir does not fold under the git dir or its parent', async () => {
      const named = await separated('named', join(tree.path, 'named.git'));
      const dotted = await separated('dotted', join(repo('elsewhere'), '.git'));
      expect(locate(named.linked)).toEqual(unfolded(named.linked));
      expect(locate(dotted.linked)).toEqual(unfolded(dotted.linked));
      expect(locate(dotted.path)).toEqual(unfolded(dotted.path));

      const inLinked = index.sessions.upsertFromSummary(summary({ directory: dotted.linked })).record;
      expect(inLinked.worktree).toBeNull();
      expect(index.projects.list().map((p) => p.directory)).toEqual([dotted.linked]);
      expect(index.sessions.refoldLinkedWorktrees()).toBe(0);
    });

    it('git runs once per directory: a second locate answers from the cache', async () => {
      const main = await checkout('main');
      await runGit(main, ['worktree', 'add', '-q', '../sibling', '-b', 'feature']);
      const sibling = join(tree.path, 'sibling');
      const { roots, mainWorktreeOf } = counted();
      const first = locate(sibling, mainWorktreeOf);
      expect(first.projectDirectory).toBe(main);
      expect(locate(sibling, mainWorktreeOf)).toEqual(first);
      expect(locate(join(tree.path, 'sibling/.'), mainWorktreeOf)).toEqual(first); // the same directory by another spelling
      expect(roots).toEqual([sibling]);
    });
  });

  it('update renames and reorders; new projects go to the end; an unknown id fails', () => {
    const a = index.projects.add(repo('alpha'));
    const b = index.projects.add(repo('beta'));
    expect([a.order, b.order]).toEqual([0, 1]);
    expect(index.projects.update(b.id, { name: 'Beta', order: -1 })).toMatchObject({ id: b.id, name: 'Beta', order: -1 });
    expect(index.projects.list().map((p) => p.id)).toEqual([b.id, a.id]);
    expect(() => index.projects.update('nope' as ProjectId, { name: 'x' })).toThrow('unknown project: nope');
    expect(() => index.projects.hide('nope' as ProjectId)).toThrow('unknown project: nope');
  });
});
