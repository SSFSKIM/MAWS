// "Open folder…" in a New chat's project picker (2026-10-01): the folder the user picked becomes a project of the index
// by the membership rule (`locate` in projects.ts): a linked or managed worktree folds under its main checkout's
// project; any other folder is a project of its own. The project is created, or made the user's and visible again, as
// `session.projects.add` does. Answers the project and where a session in that folder starts: the worktree when the
// folder is one, else the folder itself (a project's own directory, or a folder inside a worktree, where it was picked).
// MAWS's own record only: nothing under the engine's config home is written.
import { statSync } from 'node:fs';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import type { Location } from '@shared/sessions/intent';
import { locate, type ProjectStore } from './projects';

export function addFolder(projects: Pick<ProjectStore, 'ensureForDirectory'>, directory: string, locateIn: typeof locate = locate): { project: ProjectRecord; location: Location } {
  const where = locateIn(directory);
  if (where.realpath === null || where.projectDirectory === null || !statSync(where.realpath).isDirectory()) throw new Error(`not a directory: ${directory}`);
  const project = projects.ensureForDirectory(where.projectDirectory, 'user');
  const location: Location =
    where.worktreePath !== null && where.worktreePath === where.realpath
      ? { kind: 'existingWorktree', repoRoot: project.directory, path: where.worktreePath }
      : { kind: 'directory', path: where.realpath };
  return { project, location };
}
