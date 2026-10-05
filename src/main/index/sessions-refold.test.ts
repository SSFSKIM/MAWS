import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandName, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import { runGit } from '../../../test/support/git-fixture';
import { sessionIdFor, summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';
import { warmLinkedWorktrees } from './projects';
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
  const earlierRecord = (projectId: ProjectId, directory: string, branch: string, worktree: { path: string; branch: string } | null = null, transcript: ReturnType<typeof summary> | null = null) => {
    const appId = randomUUID() as AppSessionId;
    const now = new Date().toISOString();
    const db = new DatabaseSync(join(dir.path, 'index.sqlite'));
    try {
      db.prepare(
        'INSERT INTO sessions (app_id, engine_session_id, project_id, directory, branch, worktree_path, worktree_branch, transcript_path, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(appId, transcript?.sessionId ?? sessionIdFor(++engineIds), projectId, directory, branch, worktree?.path ?? null, worktree?.branch ?? null, transcript?.transcriptPath ?? null, transcript === null ? null : JSON.stringify(transcript), now, now);
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

  // A source over the index whose engine host never becomes ready, with what reaches the read model and the renderer.
  const started = (warm: (directories: string[]) => Promise<void>) => {
    const seen = { projects: [] as ProjectRecord[], removedProjects: [] as ProjectId[], records: [] as SessionRecord[], emitted: [] as { name: EventName; payload: unknown }[] };
    const host: SourceHost = {
      dispatch: async () => ({ ok: true, value: undefined }) as CommandResult<CommandName>,
      onEvent: (() => () => {}) as SourceHost['onEvent'],
      onState: () => () => {},
      snapshot: () => ({ state: 'starting', pid: null, restarts: 0, revision: 1 }),
    };
    const emit = (name: EventName, payload: unknown) => (seen.emitted.push({ name, payload }), true);
    const stop = new IndexSessionSource(index, host, { emit, tickMs: 1, warmLinkedWorktrees: warm }).start({
      observeProject: (project) => void seen.projects.push(project),
      observeRecord: (record) => void seen.records.push(record),
      observeRemoved: () => {},
      observeProjectRemoved: (id) => void seen.removedProjects.push(id),
      setDigest: () => {},
    });
    return { seen, stop };
  };

  it('the session source seeds the read model as the index holds it, then refolds once the warm-up answered, as ordinary change events', async () => {
    const discovered = index.projects.ensureForDirectory(sibling, 'discovered');
    const appId = earlierRecord(discovered.id, sibling, 'feature');
    let warming: Promise<void> | null = null;
    const { seen, stop } = started((directories) => (warming = warmLinkedWorktrees(directories)));
    try {
      expect(directoriesOf(seen.projects)).toEqual([sibling]);
      expect(seen.records).toEqual([expect.objectContaining({ appId, projectId: discovered.id, worktree: null })]);
      expect(warming).not.toBeNull();
      await warming;
      await vi.waitFor(() => expect(seen.emitted.map((e) => e.name).sort()).toEqual(['session.changed', 'session.projects.changed']));

      const mainProject = index.projects.list().find((p) => p.directory === main)!;
      const moved = { appId, projectId: mainProject.id, worktree: { path: sibling, branch: 'feature' } };
      const changed = seen.emitted.find((e) => e.name === 'session.changed')!.payload as EventPayload<'session.changed'>;
      expect(changed).toMatchObject({ cause: 'facts', record: moved });
      const projectsChanged = seen.emitted.find((e) => e.name === 'session.projects.changed')!.payload as EventPayload<'session.projects.changed'>;
      expect(directoriesOf(projectsChanged.projects)).toEqual([main]);
      expect(seen.records.at(-1)).toMatchObject(moved);
      expect(seen.projects.at(-1)).toMatchObject({ id: mainProject.id, directory: main });
      expect(seen.removedProjects).toEqual([discovered.id]);
    } finally {
      stop();
    }
  });

  it('publishes an existing discovered main project whose last transcript vanished when a user-added worktree refolds into it', async () => {
    const gone = summary({ directory: main, transcriptPath: join(dir.path, 'gone.jsonl') });
    index.sessions.upsertFromSummary(gone);
    const mainProject = index.projects.list().find((p) => p.directory === main)!;
    index.sessions.markTranscriptRemoved(gone.sessionId);
    const added = index.projects.add(sibling);
    const present = summary({ directory: sibling, gitBranch: 'feature', transcriptPath: join(dir.path, 'present.jsonl') });
    const appId = earlierRecord(added.id, sibling, 'feature', null, present);
    expect(directoriesOf(index.projects.list())).toEqual([sibling]);
    expect(index.projects.list({ includeHidden: true })).toContainEqual(mainProject);
    projectChanges = 0;

    let warming: Promise<void> | null = null;
    const { seen, stop } = started((directories) => (warming = warmLinkedWorktrees(directories)));
    try {
      expect(directoriesOf(seen.projects)).toEqual([sibling]); // the emptied main project was omitted at start
      await warming;
      const moved = { appId, projectId: mainProject.id, worktree: { path: sibling, branch: 'feature' } };
      expect(seen.records.at(-1)).toMatchObject(moved);
      await vi.waitFor(() => expect(seen.projects).toContainEqual(mainProject));

      expect(directoriesOf(index.projects.list())).toEqual([main, sibling].sort());
      expect(directoriesOf(seen.projects.slice(1))).toEqual([main, sibling].sort());
      expect(seen.removedProjects).toEqual([]); // the user-added worktree project stays
      expect(projectChanges).toBe(1);
      await vi.waitFor(() => expect(seen.emitted.map((e) => e.name).sort()).toEqual(['session.changed', 'session.projects.changed']));
      const projectsChanged = seen.emitted.find((e) => e.name === 'session.projects.changed')!.payload as EventPayload<'session.projects.changed'>;
      expect(projectsChanged.projects).toContainEqual(mainProject);
      expect(directoriesOf(projectsChanged.projects)).toEqual([main, sibling].sort());
    } finally {
      stop();
    }
  });

  it('a source stopped before the warm-up finishes runs no refold', async () => {
    const discovered = index.projects.ensureForDirectory(sibling, 'discovered');
    const appId = earlierRecord(discovered.id, sibling, 'feature');
    let finish: () => void = () => {};
    const { seen, stop } = started(() => new Promise<void>((resolve) => (finish = resolve)));
    changes = [];
    projectChanges = 0;
    stop();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(index.sessions.get(appId)).toMatchObject({ projectId: discovered.id, worktree: null });
    expect(directoriesOf(index.projects.list())).toEqual([sibling]);
    expect(changes).toEqual([]);
    expect(projectChanges).toBe(0);
    expect(seen.emitted).toEqual([]);
  });
});
