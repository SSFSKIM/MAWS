// The grid of the org's projects, as the registry socket streams it (DX3's `GridDown`): held for the tab's life, so
// the grid, the project view's title, and the phone all read one copy.
import { create } from 'zustand';
import type { ProjectSummary } from 'desk-hub/protocol';
import { GridClient } from '../hub/grid-client';
import type { ConnectionStatus } from '../hub/socket';

/** `asOf`: when the hub last sent the grid or a change to it; while reconnecting, the counts shown are that old. */
export type GridState = { projects: ProjectSummary[]; loaded: boolean; status: ConnectionStatus; asOf: number | null };

export const useGrid = create<GridState>()(() => ({ projects: [], loaded: false, status: 'connecting', asOf: null }));

let client: GridClient | null = null;

export function startGrid(base: string): () => void {
  client?.stop();
  const own = new GridClient({
    base,
    projects: (projects) => useGrid.setState({ projects, loaded: true, asOf: Date.now() }),
    status: (status) => useGrid.setState({ status }),
  });
  client = own;
  own.start();
  return () => {
    own.stop();
    if (client === own) client = null;
  };
}

/** Waiting on you first (most first), then working, then by name; a project with every machine offline goes last. */
export function sortForGrid(projects: readonly ProjectSummary[]): ProjectSummary[] {
  const offline = (p: ProjectSummary) => (p.machines_online === 0 ? 1 : 0);
  return [...projects].sort((a, b) => offline(a) - offline(b) || b.waiting - a.waiting || b.working - a.working || a.name.localeCompare(b.name));
}
