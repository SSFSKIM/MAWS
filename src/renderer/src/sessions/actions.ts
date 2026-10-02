// C10's entries in C5's action registries (C10 execution document, "Actions registered into C5"): the per-session
// entries C5's menus, hover actions and toolbar menu render through `runSessionAction`, the per-project entries its
// project menu renders through `runProjectAction`, and the workspace's "Add project" (`registerAddProject`) over C7's
// native directory chooser (`layout.pickFiles`). New chat (2026-10-01): ⌘N's `session.new` is registered with the
// session creator in C5's runtime (`registerSessionCreator`), so it follows wherever a session can be made.
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { registerSessionAction } from '../app/session-actions';
import { ipc } from '../ipc/client';
import { registerAddProject, registerProjectAction } from '../sidebar/project-actions';
import { useLayout } from '../stores/layout';
import { toast } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { attachOrSay } from './attach';
import { cleanupTargetOf } from './CleanupDialog';
import { confirm, openDialog } from './dialogs';
import { archiveSession, forkInPlace } from './record-ops';
import { resumeSession } from './setup-actions';
import { displayTitle } from './title';

const fail = (text: string) => toast({ level: 'danger', text, actions: [], dismissible: true });

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
    body: 'Running sessions stop; transcripts stay where Claude Code keeps them, and every session can be unarchived from Archived sessions.',
    confirmLabel: 'Archive',
    destructive: false,
  });
  if (!yes) return;
  const refused: string[] = [];
  for (const id of ids) {
    const answer = await archiveSession(id);
    if ('error' in answer) refused.push(`${displayTitle(sessions.records.get(id))}: ${answer.error}`);
  }
  if (refused.length > 0) fail(`Not archived: ${refused.join('; ')}`);
}

async function revealProject(projectId: ProjectId): Promise<void> {
  const project = useSessions.getState().projects.get(projectId);
  if (!project) return;
  const result = await ipc.invoke('session.revealPath', { path: project.directory });
  if (!result.ok) fail(result.error.message);
}

// "Add project": the native directory chooser, then the index's project for that directory (nothing on cancel).
async function addProject(): Promise<void> {
  const picked = await ipc.invoke('layout.pickFiles', { kind: 'directory', directory: null, multiple: false });
  if (!picked.ok) {
    fail(picked.error.message);
    return;
  }
  const directory = picked.value.files[0]?.path;
  if (directory === undefined) return;
  const added = await ipc.invoke('session.projects.add', { directory });
  if (!added.ok) fail(added.error.message);
}

export function registerSessionActions(): () => void {
  const offs = [
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
    registerProjectAction('worktrees', (projectId) => openDialog({ kind: 'worktrees', projectId })), // C12
    registerAddProject(addProject),
  ];
  return () => offs.forEach((off) => off());
}
