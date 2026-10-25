import { create } from 'zustand';
import type { ProjectId } from '@shared/graph/ids';
import type { TabRef } from '@shared/ipc/schema/layout';
import { focusedProject } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';

export type CustomizeSection = Extract<TabRef, { kind: 'customize' }>['section'];
// Undefined is a restored tab's focused project; null is an explicit choice of user scope. `directory` is a page no
// project has as its directory (a session's worktree, a folder no project owns), shown as itself (Decision Log 10).
export type CustomizePage = { projectId: ProjectId | null | undefined; directory?: string };
export const useCustomizeProject = create<CustomizePage>(() => ({ projectId: undefined }));
function showCustomize(section: CustomizeSection, page: CustomizePage): void {
  useCustomizeProject.setState(page, true);
  const layout = useLayout.getState();
  layout.revealMain();
  layout.openTab({ kind: 'customize', section });
}
export function openCustomize(section: CustomizeSection = 'plugins', projectId: ProjectId | null = focusedProject()): void {
  showCustomize(section, { projectId });
}
// P4-AGG Decision Log 10: the session `/plugins`' Open Discover. Customize opens on Plugins for the session's exact
// directory: the project whose directory it is, else the directory itself, never a parent project or the user
// configuration; the library showing that page opens on Discover, mounted already or mounting.
export const useDiscoverRequest = create<{ cwd: string | null } | { cwd?: undefined }>(() => ({}));
export function openDiscover(cwd: string): void {
  const project = [...useSessions.getState().projects.values()].find((p) => p.directory === cwd);
  showCustomize('plugins', project ? { projectId: project.id } : { projectId: null, directory: cwd });
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
