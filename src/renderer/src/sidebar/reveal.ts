// Revealing a project in the sidebar from outside it (the ⌘K palette's project entries). This shows the sidebar and
// opens the project's page (persisted, W5), then tells the mounted sidebar, which clears its search (it could hide the
// page's rows) and focuses the page. With no sidebar mounted (still loading) there is no search to clear or row to focus.
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
  useLayout.getState().setSidebar({ collapsed: false, openProject: projectId });
  revealer?.(projectId);
}
