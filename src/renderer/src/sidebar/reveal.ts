// Revealing a project in the sidebar from outside it (the ⌘K palette's project entries). This shows the sidebar and
// expands the project's row in place (persisted, W11), then tells the mounted sidebar, which clears its search (it could
// hide the row), shows every project (the row may be folded under "Show more") and scrolls the row into view and
// focuses it. A reveal made while no sidebar body is mounted (it still shows its skeleton) waits for the body to
// register; only the latest one is kept.
import { createStore } from 'zustand/vanilla';
import type { ProjectId } from '@shared/graph/ids';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { useLayout } from '../stores/layout';
import { machineOf } from '@shared/machine/address';
import { orgKeyOf, type RowKey } from '../stores/org-projects';

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
    // The same restore as Hidden projects: main persists visibility and publishes the project list.
    // A response arriving before that event is safe: the sidebar keeps its pending focus until the row mounts.
    void ipc.invoke('session.projects.add', { directory: project.directory }, { machine: machineOf(projectId) }).then((result) => {
      if (!result.ok) {
        toast({ level: 'danger', text: result.error.message, actions: [], dismissible: true });
        return;
      }
      revealVisibleProject(projectId);
    });
    return;
  }
  revealVisibleProject(projectId);
}

function revealVisibleProject(projectId: ProjectId): void {
  const project = useSessions.getState().projects.get(projectId);
  const key = project ? orgKeyOf(project) : projectId;
  useLayout.getState().setSidebar(({ expandedProjects }) => ({
    collapsed: false,
    expandedProjects: expandedProjects.includes(key) ? expandedProjects : [...expandedProjects, key],
  }));
  if (revealer) revealer(key);
  else projectReveal.setState({ pending: key });
}
