// A Customize page's `discover` view (UX wave U7b; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// Interfaces §F, "While customize/CustomizeView.tsx still takes a section"): until U11c gives the view a `view` of its own,
// it reaches the plugins library through today's `useDiscoverRequest`, addressed to the directory that library shows.
// That directory is Customize's place, the one rule `customizePlace` holds for this file and for `CustomizeView`: the
// directory page `openDiscover` chose, else the chosen project (the current row's checkout on this machine when none was
// chosen) when it is this machine's, else the user configuration.
import type { ProjectId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import { machineOf } from '@shared/machine/address';
import { useCustomizeProject, useDiscoverRequest, type CustomizePage } from '../customize/open';
import { ipc } from '../ipc/client';
import { currentRow } from '../keymap/actions-runtime';
import { localProjectOfSet, type RowKey } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';

/** Customize's place: the project it shows (none for a directory page or the user configuration) and its directory (null: the user configuration). */
export function customizePlace({ projectId: chosen, directory }: CustomizePage, current: RowKey | null, projects: Map<ProjectId, ProjectRecord>): { project: ProjectRecord | undefined; cwd: string | null } {
  if (directory !== undefined) return { project: undefined, cwd: directory };
  const focused = chosen === undefined ? (current === null ? null : (localProjectOfSet({ projects }, current, ipc.localMachine)?.id ?? null)) : chosen; // P5 O6 M5: the row's checkout here
  const project = focused !== null && machineOf(focused) === ipc.localMachine ? projects.get(focused) : undefined; // another machine's project: the user configuration
  return { project, cwd: project?.directory ?? null };
}

export function customizeDirectory(): string | null {
  return customizePlace(useCustomizeProject.getState(), currentRow(), useSessions.getState().projects).cwd;
}

/** Asks the plugins library on Customize's page to show Discover. */
export function requestDiscover(): void {
  useDiscoverRequest.setState({ cwd: customizeDirectory() }, true);
}
