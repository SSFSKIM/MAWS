// Customize's place (UX wave U7b; UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D): the one
// rule of which folder the page is about, for `CustomizeView` and for `openMine`. The directory page `openDiscover`
// chose, else the chosen project (the current row's checkout on this machine when none was chosen) when it is this
// machine's, else the user configuration.
import type { ProjectId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import { machineOf } from '@shared/machine/address';
import type { CustomizePage } from '../customize/open';
import { ipc } from '../ipc/client';
import { localProjectOfSet, type RowKey } from '../stores/org-projects';

/** Customize's place: the project it shows (none for a directory page or the user configuration) and its directory (null: the user configuration). */
export function customizePlace({ projectId: chosen, directory }: CustomizePage, current: RowKey | null, projects: Map<ProjectId, ProjectRecord>): { project: ProjectRecord | undefined; cwd: string | null } {
  if (directory !== undefined) return { project: undefined, cwd: directory };
  const focused = chosen === undefined ? (current === null ? null : (localProjectOfSet({ projects }, current, ipc.localMachine)?.id ?? null)) : chosen; // P5 O6 M5: the row's checkout here
  const project = focused !== null && machineOf(focused) === ipc.localMachine ? projects.get(focused) : undefined; // another machine's project: the user configuration
  return { project, cwd: project?.directory ?? null };
}
