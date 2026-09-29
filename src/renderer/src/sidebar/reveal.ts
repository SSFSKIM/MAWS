// Revealing a project in the sidebar from outside it (the ⌘K palette's project entries). The sidebar's search filter
// is local to the sidebar and can hide the project's row, so the reveal is the sidebar's to carry out: this shows the
// sidebar and expands the project (persisted), then hands the project to the mounted sidebar, which clears its search
// and focuses the project's row. With no sidebar mounted (still loading) there is no search to clear or row to focus.
import type { ProjectId } from '@shared/graph/ids';
import { useLayout } from '../stores/layout';

let revealer: ((projectId: ProjectId) => void) | null = null;

// The mounted sidebar registers how it reveals a project; returns the disposer.
export function registerProjectRevealer(fn: (projectId: ProjectId) => void): () => void {
  revealer = fn;
  return () => {
    if (revealer === fn) revealer = null;
  };
}

export function revealProject(projectId: ProjectId): void {
  const { regions, setSidebar } = useLayout.getState();
  setSidebar({ collapsed: false, collapsedProjects: regions.sidebar.collapsedProjects.filter((id) => id !== projectId) });
  revealer?.(projectId);
}
