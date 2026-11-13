// A Customize page's `discover` view (UX wave U7b; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// Interfaces §F, "While customize/CustomizeView.tsx still takes a section"): until U11c gives the view a `view` of its own,
// it reaches the plugins library through today's `useDiscoverRequest`, addressed to the directory that library shows.
// That directory is Customize's page, read here as `CustomizeView` reads it: the directory page `openDiscover` chose,
// else the chosen project (the current row's checkout on this machine when none was chosen), else the user configuration.
import { machineOf } from '@shared/machine/address';
import { useCustomizeProject, useDiscoverRequest } from '../customize/open';
import { ipc } from '../ipc/client';
import { currentRow } from '../keymap/actions-runtime';
import { localProjectOfSet } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';

export function customizeDirectory(): string | null {
  const { projectId: chosen, directory } = useCustomizeProject.getState();
  if (directory !== undefined) return directory;
  const { projects } = useSessions.getState();
  const current = currentRow();
  const focused = chosen === undefined ? (current === null ? null : (localProjectOfSet({ projects }, current, ipc.localMachine)?.id ?? null)) : chosen;
  const project = focused !== null && machineOf(focused) === ipc.localMachine ? projects.get(focused) : undefined;
  return project?.directory ?? null;
}

/** Asks the plugins library on Customize's page to show Discover. */
export function requestDiscover(): void {
  useDiscoverRequest.setState({ cwd: customizeDirectory() }, true);
}
