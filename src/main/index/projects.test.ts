import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectId } from '@shared/graph/ids';
import { ProjectRecordSchema } from '@shared/ipc/schema/session';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';

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
