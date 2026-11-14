import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectId } from '@shared/graph/ids';
import { ProjectRecordSchema } from '@shared/ipc/schema/session';
import { runGit } from '../../../test/support/git-fixture';
import { gitCheckout, gitWorktree, summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';
import { checkoutIn, headBranch, locate, mainWorktree, repositoryAt, warmLinkedWorktrees } from './projects';

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

  it('discovery stays available without selecting the project for the sidebar, until an explicit add', () => {
    const directory = repo('discovered');
    const { record } = index.sessions.upsertFromSummary(summary({ directory }));
    expect(index.projects.listWithRemoved().find((p) => p.id === record.projectId)).toMatchObject({ discovered: true });
    const added = index.projects.add(directory);
    expect(added.id).toBe(record.projectId);
    expect(added.discovered).not.toBe(true);
    index.projects.hide(added.id);
    index.sessions.upsertFromSummary(summary({ directory }));
    expect(index.projects.listWithRemoved().find((p) => p.id === record.projectId)).toMatchObject({ hidden: true });
  });

  it('an upgrade preserves a discovered project used by MAWS without undoing an explicit removal', () => {
    const directory = repo('used-in-maws');
    const { record } = index.sessions.upsertFromSummary(summary({ directory }));
    index.sessions.applyEngineStatus(record.appId, { holder: { kind: 'self' }, gateway: { routed: false, baseUrl: null, autoModeServer: 'unknown' } });
    index.sessions.applyEngineStatus(record.appId, { holder: { kind: 'none' } });
    const raw = new DatabaseSync(join(dir.path, 'index.sqlite'));
    raw.prepare("UPDATE projects SET origin = 'discovered' WHERE id = ?").run(record.projectId);
    raw.close();
    index.close();
    index = new Index(join(dir.path, 'index.sqlite'));
    expect(index.projects.listWithRemoved().find((p) => p.id === record.projectId)?.discovered).not.toBe(true);
    index.projects.hide(record.projectId!);
    index.close();
    index = new Index(join(dir.path, 'index.sqlite'));
    expect(index.projects.listWithRemoved().find((p) => p.id === record.projectId)?.hidden).toBe(true);
  });

  it('discovery auto-creates a project for an existing directory with a session that has messages, named by its basename', () => {
    const directory = repo('alpha');
    const { record } = index.sessions.upsertFromSummary(summary({ directory }));
    const projects = index.projects.list();
    expect(projects).toEqual([{ id: expect.any(String), name: 'alpha', directory, order: 0, createdAt: expect.any(String), discovered: true }]);
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
    expect(Object.keys(project).sort()).toEqual(['createdAt', 'directory', 'discovered', 'id', 'name', 'order']);
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
    expect(index.projects.list({ includeHidden: true }).map((p) => [p.id, p.hidden])).toEqual([[projectId, true]]);
    expect(index.projects.listWithRemoved().map((p) => [p.id, p.hidden])).toEqual([[projectId, true]]);
  });

  // W11 (I5): the renderer's list carries a removed project, but not a discovered one the refold hid once its sessions
  // moved under the main checkout (nobody removed it, and it holds nothing)
  it('the renderer’s list keeps removed projects and leaves out a hidden discovered project with no session', () => {
    const kept = index.sessions.upsertFromSummary(summary({ directory: repo('alpha') })).record.projectId!;
    const empty = index.projects.ensureForDirectory(repo('beta'), 'discovered').id;
    const added = index.projects.add(repo('gamma')).id;
    for (const id of [kept, empty, added]) index.projects.hide(id);
    expect(index.projects.listWithRemoved().map((p) => p.id).sort()).toEqual([kept, added].sort());
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
    expect(index.projects.add(directory)).toEqual(added); // shown again: no `hidden` mark
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

    // The parent git names may be a directory of its own whose files merely share names with the checkout's: a same-named
    // README proves nothing, only HEAD's content does. Both paths answer alike: `locate` on main's thread and the warm-up.
    it('a linked worktree of a separate git dir does not fold under its parent when that parent holds a same-named file of other content', async () => {
      const homes = ['home', 'home-warmed'].map((name) => {
        const home = repo(name);
        writeFileSync(join(home, 'README.md'), 'another project\n'); // `separated` commits README.md as 'hello\n'
        return home;
      });
      const located = await separated('located', join(homes[0], '.git'));
      const warmed = await separated('warmed', join(homes[1], '.git'));

      expect(locate(located.linked)).toEqual(unfolded(located.linked));
      const inLinked = index.sessions.upsertFromSummary(summary({ directory: located.linked })).record;
      expect(inLinked.worktree).toBeNull();
      expect(index.projects.list().map((p) => p.directory)).toEqual([located.linked]);
      expect(index.sessions.refoldLinkedWorktrees()).toBe(0);
      expect(index.projects.list().map((p) => p.directory)).toEqual([located.linked]);

      await warmLinkedWorktrees([warmed.linked]);
      const { roots, mainWorktreeOf } = counted();
      expect(locate(warmed.linked, mainWorktreeOf)).toEqual(unfolded(warmed.linked));
      expect(roots).toEqual([]); // answered by the warm-up
    });

    it('the main checkout is judged by content: one top-level file as HEAD records it is enough, none is no fold', async () => {
      const main = await checkout('main');
      writeFileSync(join(main, 'package.json'), '{}\n');
      await runGit(main, ['add', 'package.json']);
      await runGit(main, ['commit', '-q', '-m', 'package']);
      await runGit(main, ['worktree', 'add', '-q', '../kept', '-b', 'kept']);
      await runGit(main, ['worktree', 'add', '-q', '../edited', '-b', 'edited']);
      const [kept, edited] = ['kept', 'edited'].map((name) => join(tree.path, name));

      writeFileSync(join(main, 'README.md'), 'hello, edited\n');
      expect(locate(kept)).toEqual({ realpath: kept, projectDirectory: main, worktreePath: kept }); // package.json still matches
      writeFileSync(join(main, 'package.json'), '{ "edited": true }\n');
      expect(locate(edited)).toEqual(unfolded(edited));
    });

    it('a warm-up answers for locate: a warmed linked worktree folds with no git call on main', async () => {
      const main = await checkout('main');
      await runGit(main, ['worktree', 'add', '-q', '../sibling', '-b', 'feature']);
      const sibling = join(tree.path, 'sibling');
      await warmLinkedWorktrees([sibling, main, join(tree.path, 'gone')]);
      const { roots, mainWorktreeOf } = counted();
      expect(locate(sibling, mainWorktreeOf)).toEqual({ realpath: sibling, projectDirectory: main, worktreePath: sibling });
      expect(locate(main, mainWorktreeOf)).toEqual(unfolded(main));
      expect(roots).toEqual([]);
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

// UX wave U8c-2 (§B): a folder's repository read from git's own files, with no git run: what the index judges the
// launch folder and the working folder by. The same repository is the same common git directory; a linked work tree
// counts only while its git directory names it back.
describe("a folder's repository, from git's files", () => {
  let tree: ReturnType<typeof tempDir>;
  const at = (rel: string) => join(tree.path, rel);
  beforeAll(async () => {
    tree = tempDir('maws-repository-');
    await gitCheckout(at('repo'), 'main', { 'README.md': 'hello\n', 'src/index.ts': 'export {};\n' });
    await gitWorktree(at('repo'), at('repo/.claude/worktrees/w1'), 'worktree-w1'); // the engine's tool makes these
    await gitWorktree(at('repo'), at('side'), 'side'); // one registered by hand, beside the checkout
    await runGit(at('repo'), ['worktree', 'add', '-q', '--detach', at('detached')]);
    await gitCheckout(at('other'), 'main');
    await gitCheckout(at('repo/src/nested'), 'main'); // a repository made inside the checkout
    mkdirSync(at('plain/sub'), { recursive: true });
    mkdirSync(at('copy'));
    copyFileSync(at('side/.git'), at('copy/.git')); // a copy of a worktree's pointer: its git directory names `side`
  });
  afterAll(() => tree.dispose());

  const common = () => at('repo/.git');

  it('answers the common git directory and the work tree of a checkout, a linked worktree and a sub-folder of each', () => {
    expect(repositoryAt(at('repo'))).toEqual({ commonDir: common(), workTree: at('repo'), linked: false });
    expect(repositoryAt(at('repo/src'))).toEqual({ commonDir: common(), workTree: at('repo'), linked: false });
    expect(repositoryAt(at('repo/.claude/worktrees/w1'))).toEqual({ commonDir: common(), workTree: at('repo/.claude/worktrees/w1'), linked: true });
    expect(repositoryAt(at('repo/.claude/worktrees/w1/src'))).toEqual({ commonDir: common(), workTree: at('repo/.claude/worktrees/w1'), linked: true });
    expect(repositoryAt(at('side'))).toEqual({ commonDir: common(), workTree: at('side'), linked: true });
  });

  it('answers another repository, a nested one as its own, and none for a plain, a gone or a copied-pointer folder', () => {
    expect(repositoryAt(at('other'))).toEqual({ commonDir: at('other/.git'), workTree: at('other'), linked: false });
    expect(repositoryAt(at('repo/src/nested'))).toEqual({ commonDir: at('repo/src/nested/.git'), workTree: at('repo/src/nested'), linked: false });
    expect(repositoryAt(at('plain/sub'))).toBeNull();
    expect(repositoryAt(at('gone'))).toBeNull();
    expect(repositoryAt(at('copy'))).toBeNull(); // the git directory it names does not name it back
  });

  it("reads the branch HEAD names at a work tree, and none when it is detached or no work tree's", () => {
    expect(headBranch(at('repo'))).toBe('main');
    expect(headBranch(at('repo/.claude/worktrees/w1'))).toBe('worktree-w1');
    expect(headBranch(at('side'))).toBe('side');
    expect(headBranch(at('detached'))).toBeNull();
    expect(headBranch(at('plain'))).toBeNull();
    expect(headBranch(at('gone'))).toBeNull();
  });

  // §B's table for `checkoutIn(launch, folder)`
  it('places a folder in the launch folder\'s repository, row by row', () => {
    const w1 = at('repo/.claude/worktrees/w1');
    expect(checkoutIn(at('repo'), at('gone'))).toBeNull(); // does not resolve
    expect(checkoutIn(at('plain'), at('plain/sub'))).toEqual({ checkout: at('plain'), cwd: at('plain/sub'), workTree: null, linked: false });
    expect(checkoutIn(at('plain'), at('plain'))).toEqual({ checkout: at('plain'), cwd: at('plain'), workTree: null, linked: false });
    expect(checkoutIn(at('plain/sub'), at('plain'))).toBeNull(); // no repository, and not under the launch folder
    expect(checkoutIn(at('plain'), at('repo'))).toBeNull();
    expect(checkoutIn(at('repo'), at('plain/sub'))).toBeNull(); // no repository under a launch folder that is in one
    expect(checkoutIn(at('repo'), at('other'))).toBeNull(); // another repository
    expect(checkoutIn(at('repo'), at('repo/src/nested'))).toBeNull(); // a nested repository is another
    expect(checkoutIn(at('repo'), at('copy'))).toBeNull();
    expect(checkoutIn(at('repo/src'), at('repo/src'))).toEqual({ checkout: at('repo/src'), cwd: at('repo/src'), workTree: at('repo'), linked: false });
    expect(checkoutIn(at('repo'), at('repo/src'))).toEqual({ checkout: at('repo'), cwd: at('repo/src'), workTree: at('repo'), linked: false });
    expect(checkoutIn(at('repo/src'), at('repo'))).toEqual({ checkout: at('repo'), cwd: at('repo'), workTree: at('repo'), linked: false }); // elsewhere in its own work tree
    expect(checkoutIn(at('repo'), `${w1}/src`)).toEqual({ checkout: w1, cwd: `${w1}/src`, workTree: w1, linked: true });
    expect(checkoutIn(at('repo/src'), at('side'))).toEqual({ checkout: at('side'), cwd: at('side'), workTree: at('side'), linked: true });
    expect(checkoutIn(w1, at('repo/src'))).toEqual({ checkout: at('repo'), cwd: at('repo/src'), workTree: at('repo'), linked: false }); // the main checkout, from a worktree
  });

  // The branch review (P2): the index reads these files synchronously, inside its transaction, so a FIFO among them (a
  // `commondir`, a worktree's `gitdir`, a `HEAD`) would block it for ever at the open. Only a regular file is read; any
  // other is unreadable metadata, which answers null. Each FIFO here has a writer waiting, so a read that does open it
  // takes the file's own content and returns, and the case fails rather than hangs; the writer still waiting after the
  // call shows that nothing opened it.
  it('reads no metadata file that is not a regular file (a FIFO), and answers it as unreadable', async () => {
    const wt = await gitWorktree(at('repo'), at('fifo-wt'), 'fifo-wt');
    const gitDir = at('repo/.git/worktrees/fifo-wt');
    const asFifo = async (file: string, read: () => unknown) => {
      const content = readFileSync(file, 'utf8');
      renameSync(file, `${file}.kept`);
      execFileSync('mkfifo', [file]);
      const writer = spawn('sh', ['-c', 'printf "%s" "$0" > "$1"', content, file], { stdio: 'ignore' });
      const exited = new Promise<void>((resolve) => writer.once('exit', () => resolve()));
      try {
        const answer = read();
        await new Promise((resolve) => setTimeout(resolve, 200)); // a writer whose FIFO was opened has exited by now
        return { answer, writerWaiting: writer.exitCode === null && writer.signalCode === null };
      } finally {
        writer.kill('SIGKILL');
        await exited;
        renameSync(`${file}.kept`, file);
      }
    };
    expect.soft(await asFifo(join(gitDir, 'commondir'), () => repositoryAt(wt)), 'commondir').toEqual({ answer: null, writerWaiting: true });
    expect.soft(await asFifo(join(gitDir, 'gitdir'), () => repositoryAt(wt)), 'gitdir').toEqual({ answer: null, writerWaiting: true });
    expect.soft(await asFifo(join(gitDir, 'HEAD'), () => headBranch(wt)), 'HEAD').toEqual({ answer: null, writerWaiting: true });
    expect(repositoryAt(wt)).toEqual({ commonDir: common(), workTree: wt, linked: true }); // each file back, it reads again
    expect(headBranch(wt)).toBe('fifo-wt');
  });

  it('judges a link where it lands, and "at or under" at a segment boundary', () => {
    symlinkSync(at('side'), at('to-side'));
    expect(checkoutIn(at('repo'), at('to-side'))).toEqual({ checkout: at('side'), cwd: at('side'), workTree: at('side'), linked: true });
    mkdirSync(at('plain-2'));
    expect(checkoutIn(at('plain'), at('plain-2'))).toBeNull();
  });
});
