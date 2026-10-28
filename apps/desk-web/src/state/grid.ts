// The grid of the org's projects, as the registry socket streams it (DX3's `GridDown`): held for the tab's life, so
// the grid, the project view's title, and the phone all read one copy. The page's first grid is timed from the
// navigation's start until it is drawn (`latency/latency.ts`'s cold load).
import { useCallback } from 'react';
import { create } from 'zustand';
import type { ProjectSummary } from 'desk-hub/protocol';
import { GridClient, type AppFrames } from '../hub/grid-client';
import type { ConnectionStatus } from '../hub/socket';
import { latency } from '../latency/latency';

/** `asOf`: when the hub last sent the grid or a change to it; while reconnecting, the counts shown are that old. */
export type GridState = { projects: ProjectSummary[]; loaded: boolean; status: ConnectionStatus; asOf: number | null };

export const useGrid = create<GridState>()(() => ({ projects: [], loaded: false, status: 'connecting', asOf: null }));

let client: GridClient | null = null;
/** Where the socket's app frames go once this browser is a device (P5 O13 M3); null opens it as the grid's alone. */
let appFrames: AppFrames | null = null;
/** The page's first grid has been timed: its cold load is timed once. */
let firstGrid = false;

export function startGrid(base: string): () => void {
  client?.stop();
  const own = new GridClient({
    base,
    projects: (projects) => {
      useGrid.setState({ projects, loaded: true, asOf: Date.now() });
      // performance.now() counts from the navigation's start: 0 is when the page began loading.
      if (!firstGrid) latency.drawn('app.grid', 0);
      firstGrid = true;
    },
    status: (status) => useGrid.setState({ status }),
  });
  client = own;
  own.setApp(appFrames);
  own.start();
  return () => {
    own.stop();
    if (client === own) client = null;
  };
}

/** Opens the registry socket as an app's, its frames to `app`, or as the grid's alone (null); see `GridClient.setApp`. */
export function gridApp(app: AppFrames | null): void {
  appFrames = app;
  client?.setApp(app);
}

/** Waiting on you first (most first), then working, then by name; a project with every machine offline goes last. */
export function sortForGrid(projects: readonly ProjectSummary[]): ProjectSummary[] {
  const offline = (p: ProjectSummary) => (p.machines_online === 0 ? 1 : 0);
  return [...projects].sort((a, b) => offline(a) - offline(b) || b.waiting - a.waiting || b.working - a.working || a.name.localeCompare(b.name));
}

/** A project the grid shows by default: one with a session that has a process, or one waiting on you (a stopped seat's
 * open question is still yours to answer). A Registry still on the version before `live` (a deploy's first minutes)
 * sends none, and its projects show as every project did then. */
export const isActive = (project: ProjectSummary): boolean => project.live !== 0 || project.waiting > 0;

export function activeProjects(projects: readonly ProjectSummary[]): ProjectSummary[] {
  return projects.filter(isActive);
}

/** Whether this browser's grid shows every project rather than the active ones: a view preference, kept beside
 * `desk.depth` so it outlives a reload. */
export const GRID_ALL_KEY = 'desk.grid.all';

export function gridShowsAll(): boolean {
  try {
    return localStorage.getItem(GRID_ALL_KEY) === 'true';
  } catch {
    return false;
  }
}

export function keepGridShowsAll(all: boolean): void {
  try {
    localStorage.setItem(GRID_ALL_KEY, String(all));
  } catch {
    // Storage refused: the choice holds for this page only.
  }
}

/** A project's name as the grid shows it, by its id; a project the grid does not list, by the id's first eight characters. */
export function useProjectName(): (id: string) => string {
  const projects = useGrid((s) => s.projects);
  return useCallback((id: string) => projects.find((p) => p.id === id)?.name ?? id.slice(0, 8), [projects]);
}
