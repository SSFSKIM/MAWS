// Projects and the membership rule (C4 execution document, Interfaces "Index", *Project membership rule*). A session
// belongs to the project whose directory equals the realpath of its effective directory, or whose
// `<directory>/.claude/worktrees/<name>` contains it (then its record carries the worktree). Discovery creates a project
// (origin `discovered`, named by the basename) for an existing directory with a session that has messages; a directory
// that no longer exists has no project ("Other sessions"); a removed project is hidden and keeps its id, so rediscovery
// never resurrects it. C5's `ProjectRecord` is the row projected.
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import { slugOf } from '../../engine-host/fs/paths';
import type { Db } from './db';

interface ProjectRow {
  id: string;
  directory: string;
  name: string;
  slug: string;
  origin: 'user' | 'discovered';
  hidden: number;
  sort_order: number;
  created_at: string;
  last_activity_at: string | null;
}

export type Origin = ProjectRow['origin'];

// Where a directory lands: its realpath (null when it does not exist), the project directory it belongs under, and the
// worktree root when it lies inside `<project>/.claude/worktrees/<name>`.
export interface Location {
  realpath: string | null;
  projectDirectory: string | null;
  worktreePath: string | null;
}

const WORKTREE = /^(.+)\/\.claude\/worktrees\/([^/]+)(?:\/.*)?$/;

export function locate(directory: string | null): Location {
  if (directory === null || directory === '') return { realpath: null, projectDirectory: null, worktreePath: null };
  let realpath: string;
  try {
    realpath = realpathSync.native(directory).normalize('NFC');
  } catch {
    return { realpath: null, projectDirectory: null, worktreePath: null };
  }
  const worktree = WORKTREE.exec(realpath);
  if (!worktree) return { realpath, projectDirectory: realpath, worktreePath: null };
  return { realpath, projectDirectory: worktree[1], worktreePath: `${worktree[1]}/.claude/worktrees/${worktree[2]}` };
}

const project = (row: ProjectRow): ProjectRecord => ({
  id: row.id as ProjectId,
  name: row.name,
  directory: row.directory,
  order: row.sort_order,
  createdAt: row.created_at,
});

export class ProjectStore {
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly db: Db,
    private readonly bump: () => void, // the index-wide revision
    private readonly attachOrphans: (projectId: ProjectId, directory: string) => void, // sessions already in a new project's directory
  ) {}

  // Visible projects in their order (then by creation).
  list(opts: { includeHidden?: boolean } = {}): ProjectRecord[] {
    const where = opts.includeHidden ? '' : 'WHERE hidden = 0';
    return this.db.all<ProjectRow>(`SELECT * FROM projects ${where} ORDER BY sort_order, created_at, id`).map(project);
  }

  // The project for a realpath, creating it with `origin` when there is none. An explicit add (`user`) of a project
  // discovery created, or one the user removed, makes it the user's and visible again; discovery never unhides.
  ensureForDirectory(realpath: string, origin: Origin): ProjectRecord {
    return this.db.transaction(() => {
      const existing = this.db.get<ProjectRow>('SELECT * FROM projects WHERE directory = ?', realpath);
      if (existing) {
        if (origin === 'user' && (existing.origin !== 'user' || existing.hidden)) {
          this.db.update('projects', 'id', existing.id, { origin: 'user', hidden: 0 });
          this.changed();
        }
        return project(this.row(existing.id));
      }
      const id = randomUUID() as ProjectId;
      const { next } = this.db.get<{ next: number }>('SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM projects')!;
      this.db.insert('projects', {
        id,
        directory: realpath,
        name: basename(realpath) || realpath,
        slug: slugOf(realpath),
        origin,
        hidden: 0,
        sort_order: next,
        created_at: new Date().toISOString(),
        last_activity_at: null,
      });
      this.changed();
      this.attachOrphans(id, realpath);
      return project(this.row(id));
    });
  }

  // `session.projects.add`: an existing directory, realpathed, as the user's project.
  add(directory: string): ProjectRecord {
    const { realpath } = locate(directory);
    if (realpath === null || !statSync(realpath).isDirectory()) throw new Error(`not a directory: ${directory}`);
    return this.ensureForDirectory(realpath, 'user');
  }

  update(id: ProjectId, patch: { name?: string; order?: number }): ProjectRecord {
    return this.db.transaction(() => {
      this.row(id);
      const values: Record<string, string | number> = {};
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.order !== undefined) values.sort_order = patch.order;
      if (this.db.update('projects', 'id', id, values) > 0) this.changed();
      return project(this.row(id));
    });
  }

  // `session.projects.remove`: hidden, never deleted, so its id survives rediscovery and its sessions stay attached.
  hide(id: ProjectId): void {
    this.db.transaction(() => {
      if (this.row(id).hidden) return;
      this.db.update('projects', 'id', id, { hidden: 1 });
      this.changed();
    });
  }

  resolveMembership(effectiveDirectory: string): { projectId: ProjectId | null; worktree: SessionRecord['worktree'] } {
    const location = locate(effectiveDirectory);
    return { projectId: this.projectAt(location), worktree: location.worktreePath === null ? null : { path: location.worktreePath, branch: null } };
  }

  // The project a located directory belongs to; with `create`, discovery's rule makes one for an existing directory.
  projectAt(location: Location, create = false): ProjectId | null {
    if (location.projectDirectory === null) return null;
    const row = this.db.get<{ id: string }>('SELECT id FROM projects WHERE directory = ?', location.projectDirectory);
    if (row) return row.id as ProjectId;
    return create ? this.ensureForDirectory(location.projectDirectory, 'discovered').id : null;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private row(id: string): ProjectRow {
    const row = this.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    if (!row) throw new Error(`unknown project: ${id}`);
    return row;
  }

  private changed(): void {
    this.bump();
    this.db.defer('projects', () => {
      for (const listener of this.listeners) listener();
    });
  }
}
