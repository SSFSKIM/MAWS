// §5.1's project actions that later children answer (add directory, archive sessions, remove project, reveal in
// Finder) and the workspace's "Add project": each rendered disabled until a handler registers (residue *Slots*). The
// shell answers "New session" (`createSession`) and "Mark all read" itself.
import type { ProjectId } from '@shared/graph/ids';
import { createHandlerRegistry } from '../keymap/registry';

export const PROJECT_ACTIONS = {
  addDirectory: 'Add directory…',
  archiveSessions: 'Archive sessions…',
  removeProject: 'Remove project…',
  revealInFinder: 'Reveal in Finder',
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
