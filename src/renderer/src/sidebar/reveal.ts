// Revealing a project in the sidebar from outside it (the ⌘K palette's project entries). This shows the sidebar and
// expands the project's row in place (persisted, W11), then tells the mounted sidebar, which clears its search (it could
// hide the row), shows every project (the row may be folded under "Show more") and scrolls the row into view and
// focuses it. A reveal made while no sidebar body is mounted (it still shows its skeleton) waits for the body to
// register; only the latest one is kept.
import type { ProjectId } from '@shared/graph/ids';
import { useLayout } from '../stores/layout';

let revealer: ((projectId: ProjectId) => void) | null = null;
let unhandled: ProjectId | null = null;

// The mounted sidebar registers how it reveals a project, and takes the reveal that was waiting for it; returns the
// disposer.
export function registerProjectRevealer(fn: (projectId: ProjectId) => void): () => void {
  revealer = fn;
  if (unhandled !== null) {
    const projectId = unhandled;
    unhandled = null;
    fn(projectId);
  }
  return () => {
    if (revealer === fn) revealer = null;
  };
}

export function revealProject(projectId: ProjectId): void {
  useLayout.getState().setSidebar(({ expandedProjects }) => ({
    collapsed: false,
    expandedProjects: expandedProjects.includes(projectId) ? expandedProjects : [...expandedProjects, projectId],
  }));
  if (revealer) revealer(projectId);
  else unhandled = projectId;
}
