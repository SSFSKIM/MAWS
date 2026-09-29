// §5.1's project actions that later children answer (archive sessions, remove project, reveal in Finder, the archived
// sessions list) and the workspace's "Add project": each rendered disabled until a handler registers (residue
// *Slots*). The shell answers "New session" (`createSession`) and "Mark all read" itself. The project-level "Add
// directory…" is retired (charter 733051f: a project is one directory; a session's additional directories are the
// composer's chip, §5.4).
import type { ProjectId } from '@shared/graph/ids';
import { createHandlerRegistry } from '../keymap/registry';

export const PROJECT_ACTIONS = {
  archiveSessions: 'Archive sessions…',
  removeProject: 'Remove project…',
  revealInFinder: 'Reveal in Finder',
  // C10 start: a project's archived sessions, a dialog list (C5 hides archived rows and gains no section)
  archivedSessions: 'Archived sessions…',
  // C10 end
} as const;
export type ProjectActionId = keyof typeof PROJECT_ACTIONS;
export const PROJECT_ACTION_IDS = Object.keys(PROJECT_ACTIONS) as ProjectActionId[];

const projectRegistry = createHandlerRegistry<ProjectActionId, [ProjectId]>('project actions');
export const registerProjectAction = (id: ProjectActionId, handler: (projectId: ProjectId) => unknown): (() => void) =>
  projectRegistry.register(id, handler);
export const runProjectAction = (id: ProjectActionId, projectId: ProjectId): void => projectRegistry.run(id, projectId);
export const useProjectActionEnabled = (id: ProjectActionId): boolean => projectRegistry.useEnabled(id);

const workspaceRegistry = createHandlerRegistry<'addProject', []>('workspace actions');
export const registerAddProject = (handler: () => unknown): (() => void) => workspaceRegistry.register('addProject', handler);
export const runAddProject = (): void => workspaceRegistry.run('addProject');
export const useAddProjectEnabled = (): boolean => workspaceRegistry.useEnabled('addProject');
