import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import { runGit } from '../../../test/support/git-fixture';
import { sessionIdFor, summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';
import type { ChangeCause } from './sessions';
import { IndexSessionSource, type SourceHost } from './source';

// The start-up pass that moves records an earlier membership rule filed under a linked worktree's own project (C4
// execution document, Decision Log, 2026-10-01).
describe('refolding linked worktrees under their main checkout', () => {
  let dir: ReturnType<typeof tempDir>;
  let tree: ReturnType<typeof tempDir>;
  let index: Index;
  let changes: [AppSessionId, ChangeCause][];
  let projectChanges: number;
  let main: string;
  let sibling: string;
  let other: string;
  beforeEach(async () => {
    dir = tempDir();
    tree = tempDir('maws-refold-');
    index = new Index(join(dir.path, 'index.sqlite'));
    changes = [];
    projectChanges = 0;
    index.sessions.onChange((record, cause) => changes.push([record.appId, cause]));
    index.projects.onChange(() => (projectChanges += 1));
    main = join(tree.path, 'main');
    mkdirSync(main);
    await runGit(main, ['init', '-q', '-b', 'main']);
    writeFileSync(join(main, 'README.md'), 'hello\n');
    await runGit(main, ['add', 'README.md']);
    await runGit(main, ['commit', '-q', '-m', 'initial']);
    await runGit(main, ['worktree', 'add', '-q', '../sibling', '-b', 'feature']);
    await runGit(main, ['worktree', 'add', '-q', '../other', '-b', 'other']);
    sibling = join(tree.path, 'sibling');
    other = join(tree.path, 'other');
  });
  afterEach(() => {
    index.close();
    dir.dispose();
    tree.dispose();
  });

  // A record as the earlier rule left it, written through a second connection: in the linked worktree's own project,
  // with no worktree unless it was a managed one inside it.
  let engineIds = 0x200000;
  const earlierRecord = (projectId: ProjectId, directory: string, branch: string, worktree: { path: string; branch: string } | null = null) => {
    const appId = randomUUID() as AppSessionId;
    const now = new Date().toISOString();
    const db = new DatabaseSync(join(dir.path, 'index.sqlite'));
    try {
      db.prepare(
        'INSERT INTO sessions (app_id, engine_session_id, project_id, directory, branch, worktree_path, worktree_branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(appId, sessionIdFor(++engineIds), projectId, directory, branch, worktree?.path ?? null, worktree?.branch ?? null, now, now);
    } finally {
      db.close();
    }
    return appId;
  };

  const directoriesOf = (projects: ProjectRecord[]) => projects.map((p) => p.directory).sort();

  it('moves each record to the main checkout\'s project with its worktree, hides the discovered sibling, keeps the user\'s, and a second pass changes nothing', () => {
    const discovered = index.projects.ensureForDirectory(sibling, 'discovered');
    const added = index.projects.add(other);
    const inSibling = earlierRecord(discovered.id, sibling, 'feature');
    const managed = join(sibling, '.claude/worktrees/wt');
    const inManaged = earlierRecord(discovered.id, managed, 'wt', { path: managed, branch: 'wt' });
    const inOther = earlierRecord(added.id, other, 'other');
    changes = [];
    projectChanges = 0;

    expect(index.sessions.refoldLinkedWorktrees()).toBe(3);
    const mainProject = index.projects.list().find((p) => p.directory === main)!; // created: no session sat there before
    expect(directoriesOf(index.projects.list())).toEqual([main, other].sort());
    expect(directoriesOf(index.projects.list({ includeHidden: true }))).toEqual([main, other, sibling].sort());
    expect(index.sessions.get(inSibling)).toMatchObject({ projectId: mainProject.id, directory: sibling, worktree: { path: sibling, branch: 'feature' } });
    expect(index.sessions.get(inManaged)).toMatchObject({ projectId: mainProject.id, worktree: { path: managed, branch: 'wt' } });
    expect(index.sessions.get(inOther)).toMatchObject({ projectId: mainProject.id, worktree: { path: other, branch: 'other' } });
    expect(changes.sort()).toEqual(([[inSibling, 'facts'], [inManaged, 'facts'], [inOther, 'facts']] as [AppSessionId, ChangeCause][]).sort());
    expect(projectChanges).toBe(1); // one transaction: the main project created, the sibling hidden

    // Discovery agrees with the pass: the record's next summary leaves it where the pass put it.
    const engineId = index.sessions.get(inSibling)!.engineSessionId!;
    const next = index.sessions.upsertFromSummary(summary({ sessionId: engineId, directory: sibling, gitBranch: 'feature' })).record;
    expect(next).toMatchObject({ projectId: mainProject.id, worktree: { path: sibling, branch: 'feature' } });

    changes = [];
    projectChanges = 0;
    expect(index.sessions.refoldLinkedWorktrees()).toBe(0);
    expect(changes).toEqual([]);
    expect(projectChanges).toBe(0);
  });

  it('the session source refolds at start, before it seeds the read model', () => {
    const discovered = index.projects.ensureForDirectory(sibling, 'discovered');
    const appId = earlierRecord(discovered.id, sibling, 'feature');
    const projects: ProjectRecord[] = [];
    const records: SessionRecord[] = [];
    const host: SourceHost = {
      dispatch: async () => ({ ok: true, value: undefined }) as CommandResult<CommandName>,
      onEvent: (() => () => {}) as SourceHost['onEvent'],
      onState: () => () => {},
      snapshot: () => ({ state: 'starting', pid: null, restarts: 0, revision: 1 }),
    };
    const stop = new IndexSessionSource(index, host, { emit: () => true }).start({
      observeProject: (project) => void projects.push(project),
      observeRecord: (record) => void records.push(record),
      observeRemoved: () => {},
      observeProjectRemoved: () => {},
      setDigest: () => {},
    });
    stop();
    expect(directoriesOf(projects)).toEqual([main]);
    expect(records.find((r) => r.appId === appId)).toMatchObject({ projectId: projects[0].id, worktree: { path: sibling, branch: 'feature' } });
  });
});
