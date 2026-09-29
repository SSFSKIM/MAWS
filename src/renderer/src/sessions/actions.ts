// C10's entries in C5's action registries (C10 execution document, "Actions registered into C5"): ⌘N and the palette's
// `session.new`, the per-session entries C5's menus, hover actions and toolbar menu render through
// `runSessionAction`, and the per-project entries its project menu renders through `runProjectAction`. "Add project"
// (`registerAddProject` over C7's `layout.pickFiles`) arrives with M4b.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { registerSessionAction } from '../app/session-actions';
import { ipc } from '../ipc/client';
import { createSession, registerAction } from '../keymap/actions-runtime';
import { registerProjectAction } from '../sidebar/project-actions';
import { useLayout } from '../stores/layout';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { attachOrSay } from './attach';
import { cleanupTargetOf } from './CleanupDialog';
import { confirm, openDialog } from './dialogs';
import { archiveSession, forkInPlace } from './record-ops';
import { resumeSession } from './setup-actions';
import { useSetup } from './store';

const fail = (text: string) => toast({ level: 'danger', text, actions: [], dismissible: true });

// The project ⌘N creates in: the focused session's, else the first project, else none.
export function focusedProject(): ProjectId | null {
  const { main } = useLayout.getState();
  const pane = main.panes[main.focusedPane] ?? main.panes[0];
  const active = pane?.tabs.find((t) => t.id === pane.activeTabId);
  const sessions = useSessions.getState();
  if (active?.kind === 'session' || active?.kind === 'agent') {
    const id = active.appSessionId;
    const projectId = sessions.records.get(id)?.projectId ?? useSetup.getState().intents.get(id)?.projectId ?? sessions.unstarted.get(id)?.projectId ?? null;
    if (projectId !== null) return projectId;
  }
  const first = [...sessions.projects.values()].sort((a, b) => a.order - b.order)[0];
  return first?.id ?? null;
}

function removeWorktree(appSessionId: AppSessionId): void {
  const record = useSessions.getState().records.get(appSessionId);
  const target = record ? cleanupTargetOf(record) : null;
  if (target) openDialog({ kind: 'cleanup', target });
}

async function removeProject(projectId: ProjectId): Promise<void> {
  const sessions = useSessions.getState();
  const project = sessions.projects.get(projectId);
  if (!project) return;
  const count = [...sessions.records.values()].filter((r) => r.projectId === projectId && !r.archived).length;
  const yes = await confirm({
    title: `Remove ${project.name}?`,
    body: `${count} ${count === 1 ? 'session stays' : 'sessions stay'} on disk and in the terminal; the project leaves the sidebar until you add it again.`,
    confirmLabel: 'Remove project',
    destructive: false,
  });
  if (!yes) return;
  const result = await ipc.invoke('session.projects.remove', { id: projectId });
  if (!result.ok) fail(result.error.message);
}

async function archiveProjectSessions(projectId: ProjectId): Promise<void> {
  const sessions = useSessions.getState();
  const project = sessions.projects.get(projectId);
  const ids = [...sessions.records.values()].filter((r) => r.projectId === projectId && !r.archived).map((r) => r.appId);
  if (!project || ids.length === 0) return;
  const yes = await confirm({
    title: `Archive ${ids.length} ${ids.length === 1 ? 'session' : 'sessions'} in ${project.name}?`,
    body: 'Running sessions stop; transcripts stay under ~/.claude and every session can be unarchived from Archived sessions.',
    confirmLabel: 'Archive',
    destructive: false,
  });
  if (!yes) return;
  const refused: string[] = [];
  for (const id of ids) {
    const answer = await archiveSession(id);
    if ('error' in answer) refused.push(`${sessions.records.get(id)?.title.text ?? id}: ${answer.error}`);
  }
  if (refused.length > 0) fail(`Not archived: ${refused.join('; ')}`);
}

async function revealProject(projectId: ProjectId): Promise<void> {
  const project = useSessions.getState().projects.get(projectId);
  if (!project) return;
  const result = await ipc.invoke('session.revealPath', { path: project.directory });
  if (!result.ok) fail(result.error.message);
}

export function registerSessionActions(): () => void {
  const offs = [
    registerAction('session.new', () => createSession(focusedProject())),
    // the session's tab first, so a trust or relay card its start docks is on screen
    registerSessionAction('resume', (id) => {
      useLayout.getState().openSession(id);
      return resumeSession(id);
    }),
    registerSessionAction('rename', (id) => openDialog({ kind: 'rename', appSessionId: id })),
    registerSessionAction('fork', (id) => forkInPlace(id)),
    registerSessionAction('forkToWorktree', (id) => openDialog({ kind: 'fork', appSessionId: id })),
    registerSessionAction('archive', (id) => openDialog({ kind: 'archive', appSessionId: id })),
    registerSessionAction('deleteConversation', (id) => openDialog({ kind: 'delete', appSessionId: id })),
    registerSessionAction('removeWorktree', removeWorktree),
    registerSessionAction('attach', (id) => attachOrSay(id)),
    registerProjectAction('removeProject', removeProject),
    registerProjectAction('archiveSessions', archiveProjectSessions),
    registerProjectAction('revealInFinder', revealProject),
    registerProjectAction('archivedSessions', (projectId) => openDialog({ kind: 'archived', projectId })),
  ];
  return () => offs.forEach((off) => off());
}
