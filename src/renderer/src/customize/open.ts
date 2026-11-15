import { create } from 'zustand';
import type { ProjectId } from '@shared/graph/ids';
import { focusedProject, currentRow } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { customizePlace } from '../destination/discover';
import { useCustomizePage, useOpenRequest, type CustomizeShow } from './page';

// The ways into Customize's page (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D "Ways
// in"; U7b's page beside the sidebar, which covers the side column whatever its state and which Back finds as it was, so
// no opener docks it). Each writes the page's two fields, its view and its Show value, through `openDestination`.
// The composer's names for a kind, kept: `mcp` is the Connectors kind.
export type CustomizeSection = 'plugins' | 'skills' | 'mcp';
const SHOW: Readonly<Record<CustomizeSection, CustomizeShow>> = { plugins: 'plugins', skills: 'skills', mcp: 'connectors' };
// Undefined is a restored page's current project; null is an explicit choice of user scope. `directory` is a page no
// project has as its directory (a session's worktree, a folder no project owns), shown as itself (Decision Log 10).
export type CustomizePage = { projectId: ProjectId | null | undefined; directory?: string };
export const useCustomizeProject = create<CustomizePage>(() => ({ projectId: undefined }));

/** My items for `projectId`'s page: All with no kind asked (the sidebar's row, Settings' "Customize ›"), else that kind. */
export function openCustomize(section?: CustomizeSection, projectId: ProjectId | null = focusedProject()): void {
  useCustomizeProject.setState({ projectId }, true);
  useLayout.getState().openDestination({ kind: 'customize', view: 'mine', show: section === undefined ? 'all' : SHOW[section] });
}

// P4-AGG Decision Log 10: the session `/plugins`' Open Discover. Discover, Plugins, for the session's exact directory: the
// project whose directory it is, else the directory itself, never a parent project or the user configuration.
// P5 O6 M4: `cwd` is this machine's (the session plugin widgets open it only for this machine's sessions), so it names
// this machine's project of that directory, never another machine's of the same path (Customize is local until O4).
// UX wave U11a: null, from an unstarted tab with no folder chosen, is the user configuration's page.
export function openDiscover(cwd: string | null): void {
  const project = cwd === null ? undefined : [...useSessions.getState().projects.values()].find((p) => p.directory === cwd && machineOf(p.id) === ipc.localMachine);
  useCustomizeProject.setState(project ? { projectId: project.id } : cwd === null ? { projectId: null } : { projectId: null, directory: cwd }, true);
  useLayout.getState().openDestination({ kind: 'customize', view: 'discover', show: 'plugins' });
}

/** My items with `show` on the page's own place: a Discover card that reads "Installed". A `pluginId` opens that plugin's
 * detail once My items lists it; `search` sets the page's text (a Skills card names its plugin). */
export function openMine(show: Exclude<CustomizeShow, 'all'>, item: { pluginId?: string; search?: string } = {}): void {
  useLayout.getState().openDestination({ kind: 'customize', view: 'mine', show });
  if (item.search !== undefined) useCustomizePage.setState({ search: item.search });
  const place = customizePlace(useCustomizeProject.getState(), currentRow(), useSessions.getState().projects).cwd;
  useOpenRequest.setState({ request: item.pluginId === undefined ? null : { pluginId: item.pluginId, place, show } });
}

export function openProjects(): void {
  useLayout.getState().openDestination({ kind: 'projects' });
}
