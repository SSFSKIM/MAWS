// Revealing a project in the sidebar from outside it (the ⌘K palette's project entries; UX wave U13a: the title bar's
// chip, by row). This shows the sidebar and expands the project's row in place (persisted, W11), then tells the mounted
// sidebar, which clears its search (it could hide the row), shows every project (the row may be folded under "Show
// more") and scrolls the row into view and focuses it. A reveal made while no sidebar body is mounted (it still shows its
// skeleton) waits for the body to register; only the latest one is kept.
import { createStore } from 'zustand/vanilla';
import type { ProjectId } from '@shared/graph/ids';
import type { ProjectRecord } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { showSidebar } from '../app/shell-view';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { useLayout } from '../stores/layout';
import { machineOf } from '@shared/machine/address';
import { machineOfRow, selectOrgIndex, type OrgIndex, type RowKey } from '../stores/org-projects';

// P5 O6 M5: a project is revealed by its row, its org project's (one row whatever machines check it out).
let revealer: ((key: RowKey) => void) | null = null;
export const projectReveal = createStore<{ pending: RowKey | null }>(() => ({ pending: null }));

// The mounted sidebar registers how it reveals a project, and takes the reveal that was waiting for it; returns the
// disposer.
export function registerProjectRevealer(fn: (key: RowKey) => void): () => void {
  revealer = fn;
  const key = projectReveal.getState().pending;
  if (key !== null) {
    projectReveal.setState({ pending: null });
    fn(key);
  }
  return () => {
    if (revealer === fn) revealer = null;
  };
}

export function revealProject(projectId: ProjectId): void {
  const project = useSessions.getState().projects.get(projectId);
  if (project && (project.hidden || project.discovered)) {
    restoreThen(project, () => revealVisibleProject(projectId));
    return;
  }
  revealVisibleProject(projectId);
}

// The same restore as Hidden projects: main persists visibility and publishes the project list. A response arriving
// before that event is safe: the sidebar keeps its pending focus until the row mounts.
function restoreThen(project: ProjectRecord, reveal: () => void): void {
  void ipc.invoke('session.projects.add', { directory: project.directory }, { machine: machineOf(project.id) }).then((result) => {
    if (!result.ok) {
      toast({ level: 'danger', text: result.error.message, actions: [], dismissible: true });
      return;
    }
    reveal();
  });
}

/** Whether the sidebar lists the row: a machine's own row always, a project's while one of its checkouts is not hidden. */
export const sidebarListsRow = (index: OrgIndex, key: RowKey): boolean => machineOfRow(key) !== null || index.listed.has(key);

/**
 * U13a (the title bar's chip, O-31): shows the sidebar as the `sidebar.focus` action does (the overlay where the sidebar
 * steps aside), opens the row and hands it to the mounted sidebar, which scrolls it into view and focuses it. A row the
 * sidebar does not list (a hidden project's) is restored first, on this Mac's folder of it when there is one, else on the
 * first machine's in machine order.
 */
export function revealRow(key: RowKey): void {
  const local = ipc.localMachine;
  const index = selectOrgIndex(useSessions.getState(), local);
  const hidden = sidebarListsRow(index, key) ? undefined : restorable(index, key, local);
  if (hidden) restoreThen(hidden, () => revealListedRow(key));
  else revealListedRow(key);
}

// The record a row's restore acts on: this Mac's first, then by machine ref; on one machine its checkouts first.
function restorable(index: OrgIndex, key: RowKey, local: MachineRef): ProjectRecord | undefined {
  const before = (a: ProjectRecord, b: ProjectRecord): number => {
    const [x, y] = [machineOf(a.id), machineOf(b.id)];
    if (x === y) return Number(a.discovered ?? false) - Number(b.discovered ?? false);
    return x === local ? -1 : y === local ? 1 : x < y ? -1 : 1;
  };
  return (index.projects.get(key) ?? []).filter((p) => p.hidden || p.discovered).sort(before)[0];
}

function revealListedRow(key: RowKey): void {
  showSidebar();
  useLayout.getState().setSidebar(({ expandedProjects }) => ({ expandedProjects: expandedProjects.includes(key) ? expandedProjects : [...expandedProjects, key] }));
  if (revealer) revealer(key);
  else projectReveal.setState({ pending: key });
}

function revealVisibleProject(projectId: ProjectId): void {
  const sessions = useSessions.getState();
  const project = sessions.projects.get(projectId);
  const key = project ? selectOrgIndex(sessions, ipc.localMachine).keyOf(project) : projectId; // the project registry: its row's key
  useLayout.getState().setSidebar(({ expandedProjects }) => ({
    collapsed: false,
    expandedProjects: expandedProjects.includes(key) ? expandedProjects : [...expandedProjects, key],
  }));
  if (revealer) revealer(key);
  else projectReveal.setState({ pending: key });
}
