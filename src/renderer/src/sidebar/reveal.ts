// Revealing a project in the sidebar from outside it (the ⌘K palette's project entries). This shows the sidebar and
// expands the project's row in place (persisted, W11), then tells the mounted sidebar, which clears its search (it could
// hide the row) and scrolls the row into view and focuses it. With no sidebar mounted (still loading) there is no
// search to clear or row to focus.
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
  useLayout.getState().setSidebar(({ expandedProjects }) => ({
    collapsed: false,
    expandedProjects: expandedProjects.includes(projectId) ? expandedProjects : [...expandedProjects, projectId],
  }));
  revealer?.(projectId);
}
