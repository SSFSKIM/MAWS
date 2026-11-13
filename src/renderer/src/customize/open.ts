import { create } from 'zustand';
import type { ProjectId } from '@shared/graph/ids';
import { focusedProject } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { SHOW_OF_SECTION } from '../destination/customize';

// Customize's sections (UX wave U7b: no longer a tab's; the page stores its `show`, `../destination/customize`).
export type CustomizeSection = 'plugins' | 'skills' | 'mcp';
// Undefined is a restored tab's focused project; null is an explicit choice of user scope. `directory` is a page no
// project has as its directory (a session's worktree, a folder no project owns), shown as itself (Decision Log 10).
export type CustomizePage = { projectId: ProjectId | null | undefined; directory?: string };
export const useCustomizeProject = create<CustomizePage>(() => ({ projectId: undefined }));
// UX wave U7b (O-40; its execution document, Interfaces §J, "Every way in"): Customize, Projects and the library open as
// a page beside the sidebar, not a tab. A page covers the side column whatever its state and Back finds it as it was, so
// none of the openers docks it (`revealMain`) any more.
function showCustomize(section: CustomizeSection, page: CustomizePage, view: 'mine' | 'discover' = 'mine'): void {
  useCustomizeProject.setState(page, true);
  useLayout.getState().openDestination({ kind: 'customize', view, show: SHOW_OF_SECTION[section] });
}
export function openCustomize(section: CustomizeSection = 'plugins', projectId: ProjectId | null = focusedProject()): void {
  showCustomize(section, { projectId });
}
// P4-AGG Decision Log 10: the session `/plugins`' Open Discover. Customize opens on Plugins for the session's exact
// directory: the project whose directory it is, else the directory itself, never a parent project or the user
// configuration; the library showing that page opens on Discover, mounted already or mounting.
export const useDiscoverRequest = create<{ cwd: string | null } | { cwd?: undefined }>(() => ({}));
// P5 O6 M4: `cwd` is this machine's (the session plugin widgets open it only for this machine's sessions), so it names
// this machine's project of that directory, never another machine's of the same path (Customize is local until O4).
// UX wave U11a: null, from an unstarted tab with no folder chosen, is the user configuration's page.
export function openDiscover(cwd: string | null): void {
  const project = cwd === null ? undefined : [...useSessions.getState().projects.values()].find((p) => p.directory === cwd && machineOf(p.id) === ipc.localMachine);
  showCustomize('plugins', project ? { projectId: project.id } : cwd === null ? { projectId: null } : { projectId: null, directory: cwd }, 'discover');
  useDiscoverRequest.setState({ cwd }, true);
}
/** Takes the request when it is for the library showing `cwd`'s page; answers whether it did. */
export function takeDiscoverRequest(cwd: string | null): boolean {
  if (useDiscoverRequest.getState().cwd !== cwd) return false;
  useDiscoverRequest.setState({}, true);
  return true;
}

export function openProjects(): void {
  useLayout.getState().openDestination({ kind: 'projects' });
}
