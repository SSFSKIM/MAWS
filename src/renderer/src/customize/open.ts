import { create } from 'zustand';
import type { ProjectId } from '@shared/graph/ids';
import type { TabRef } from '@shared/ipc/schema/layout';
import { focusedProject } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';

export type CustomizeSection = Extract<TabRef, { kind: 'customize' }>['section'];
// Undefined is a restored tab's focused project; null is an explicit choice of user scope.
export const useCustomizeProject = create<{ projectId: ProjectId | null | undefined }>(() => ({ projectId: undefined }));
export function openCustomize(section: CustomizeSection = 'plugins', projectId: ProjectId | null = focusedProject()): void {
  useCustomizeProject.setState({ projectId });
  const layout = useLayout.getState();
  layout.revealMain();
  layout.openTab({ kind: 'customize', section });
}
// P4-AGG Decision Log 10: the session `/plugins`' Open Discover. Customize opens on Plugins for the project, and the
// library showing that project's page (null: the user configuration) opens on Discover, mounted already or mounting.
export const useDiscoverRequest = create<{ cwd: string | null } | { cwd?: undefined }>(() => ({}));
export function openDiscover(projectId: ProjectId | null): void {
  const cwd = projectId === null ? null : (useSessions.getState().projects.get(projectId)?.directory ?? null);
  openCustomize('plugins', projectId);
  useDiscoverRequest.setState({ cwd }, true);
}
/** Takes the request when it is for the library showing `cwd`'s page; answers whether it did. */
export function takeDiscoverRequest(cwd: string | null): boolean {
  if (useDiscoverRequest.getState().cwd !== cwd) return false;
  useDiscoverRequest.setState({}, true);
  return true;
}

export function openProjects(): void {
  const layout = useLayout.getState();
  layout.revealMain();
  layout.openTab({ kind: 'projects' });
}
