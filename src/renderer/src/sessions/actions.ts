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
import { archiveSession, forkInPlace, takeOverSession } from './record-ops';
import { resumeSession } from './setup-actions';
import { displayTitle } from './title';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { selectOffline, useMachines } from '../stores/machines';
import { orgKeyOf, reachableCheckouts, rowProjects, selectOrgIndex, sessionsOfRow } from '../stores/org-projects';

const fail = (text: string) => toast({ level: 'danger', text, actions: [], dismissible: true });

function removeWorktree(appSessionId: AppSessionId): void {
  const record = useSessions.getState().records.get(appSessionId);
  const target = record ? cleanupTargetOf(record) : null;
  if (target) openDialog({ kind: 'cleanup', target });
}

// P5 O6 M5: a project's row is its org project's, spanning machines. Its actions reach the row's checkouts and sessions on
// every machine that is up; a checkout on an offline machine stays as it is, and shows the row again when it returns.
const up = (machine: MachineRef) => !selectOffline(useMachines.getState(), machine);
function rowOf(projectId: ProjectId) {
  const sessions = useSessions.getState();
  const project = sessions.projects.get(projectId);
  if (!project) return null;
  return { sessions, project, key: orgKeyOf(project), index: selectOrgIndex(sessions, ipc.localMachine) };
}

async function removeProject(projectId: ProjectId): Promise<void> {
  const row = rowOf(projectId);
  if (!row) return;
  const { sessions, project, key, index } = row;
  const name = index.orgs.get(key)?.name ?? project.name;
  const checkouts = index.listed.has(key) ? reachableCheckouts(index, key, up) : [project];
  const count = sessionsOfRow(sessions, ipc.localMachine, key).filter((r) => !r.archived).length;
  // W11 (I5): the project row's archive icon and the menu's "Remove from sidebar…"; nothing is deleted
  const yes = await confirm({
    title: `Remove ${name} from the sidebar?`,
    body: `Its ${count} ${count === 1 ? 'session stays' : 'sessions stay'} on disk and in the terminal. Show the project again from Hidden projects… at the end of the sidebar's list.`,
    confirmLabel: 'Remove from sidebar',
    destructive: false,
  });
  if (!yes) return;
  // each checkout is hidden on its own machine (`session.projects.remove` routes by the project's address)
  for (const checkout of checkouts) {
    const result = await ipc.invoke('session.projects.remove', { id: checkout.id });
    if (!result.ok) fail(result.error.message);
  }
}

async function archiveProjectSessions(projectId: ProjectId): Promise<void> {
  const row = rowOf(projectId);
  if (!row) return;
  const { sessions, project, key, index } = row;
  const ids = sessionsOfRow(sessions, ipc.localMachine, key).filter((r) => !r.archived && up(machineOf(r.appId))).map((r) => r.appId);
  if (ids.length === 0) return;
  const yes = await confirm({
    title: `Archive ${ids.length} ${ids.length === 1 ? 'session' : 'sessions'} in ${index.orgs.get(key)?.name ?? project.name}?`,
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

async function archiveOlder(projectId: ProjectId): Promise<void> {
  const row = rowOf(projectId);
  const targets = row ? rowProjects(row.index, row.key, up).map((p) => p.id) : [projectId]; // one the page does not know: main says
  let archived = 0;
  let skipped = 0;
  for (const target of targets) {
    const result = await ipc.invoke('session.archiveOlder', { projectId: target, days: 7 });
    if (!result.ok) {
      fail(result.error.message);
      return;
    }
    archived += result.value.archived;
    skipped += result.value.skipped;
  }
  toast({ level: 'info', text: `${archived} sessions archived; ${skipped} kept`, actions: [], dismissible: true });
}

async function revealProject(projectId: ProjectId): Promise<void> {
  const project = useSessions.getState().projects.get(projectId);
  if (!project) return;
  const result = await ipc.invoke('session.revealPath', { path: project.directory }, { machine: machineOf(projectId) }); // the project's machine's Finder (the stand-in's: B's)
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
  const added = await ipc.invoke('session.projects.add', { directory }, { machine: ipc.localMachine }); // P5 O6 M4: this Mac's chooser, this machine's folder
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
    // P5 O9 M5: Take over from the menu of a terminal session MAWS drives through its bridge, with today's confirm
    registerSessionAction('takeOver', (id) => {
      const holder = useSessions.getState().records.get(id)?.holder;
      if (holder && (holder.kind === 'terminal' || holder.kind === 'background_job')) return takeOverSession(id, holder);
    }),
    registerProjectAction('removeProject', removeProject),
    registerProjectAction('archiveSessions', archiveProjectSessions),
    registerProjectAction('archiveOlder', archiveOlder),
    registerProjectAction('revealInFinder', revealProject),
    registerProjectAction('archivedSessions', (projectId) => openDialog({ kind: 'archived', projectId })),
    registerProjectAction('worktrees', (projectId) => openDialog({ kind: 'worktrees', projectId })), // C12
    registerAddProject(addProject),
  ];
  return () => offs.forEach((off) => off());
}
