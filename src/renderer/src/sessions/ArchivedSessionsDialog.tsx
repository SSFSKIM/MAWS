// A project's archived sessions (C10 execution document, Actions: `project.archived`): a dialog list, not a sidebar
// section (C5 hides archived rows and C10 adds none). Each row offers Unarchive (C4's `session.update`), Delete, and,
// for a session in a managed worktree, "Remove worktree…" (the cleanup dialog). P5 O6 M5: the sessions of no project are
// one machine's (its row's menu names it; this machine's by default), read from that machine and titled by its name.
import { useEffect, useState } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';
import { isManagedWorktree } from './ArchiveDialog';
import { cleanupTargetOf } from './CleanupDialog';
import { openDialog } from './dialogs';
import { Sheet } from './Sheet';
import { QUIET, SECONDARY } from './ui';
import { displayTitle } from './title';

export function ArchivedSessionsDialog({ projectId, machine: named }: { projectId: ProjectId | null; machine?: MachineRef }) {
  const project = useSessions((s) => (projectId === null ? null : (s.projects.get(projectId) ?? null)));
  const machine = projectId === null ? (named ?? ipc.localMachine) : machineOf(projectId);
  const machineLabel = useMachines((s) => machineName(s.machines, machine, ipc.localMachine));
  const [rows, setRows] = useState<SessionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // read again after an unarchive

  useEffect(() => {
    let live = true;
    void ipc.invoke('session.list', { includeArchived: true }, { machine }).then((result) => {
      if (!live) return;
      if (!result.ok) return setError(result.error.message);
      setRows(result.value.sessions.filter((r) => r.archived && r.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    });
    return () => {
      live = false;
    };
  }, [projectId, machine, version]);

  const unarchive = async (appSessionId: AppSessionId) => {
    const result = await ipc.invoke('session.update', { appSessionId, patch: { archived: false } });
    if (!result.ok) setError(result.error.message);
    setVersion((v) => v + 1);
  };

  return (
    <Sheet title={`Archived sessions${projectId === null ? ` · ${machineLabel}` : project ? ` · ${project.name}` : ''}`} width="w-[min(560px,92vw)]">
      {rows === null ? (
        <p className="m-0 text-fg-muted">{error ?? 'Loading…'}</p>
      ) : rows.length === 0 ? (
        <p className="m-0 text-fg-muted">No archived sessions.</p>
      ) : (
        <ul aria-label="Archived sessions" className="m-0 flex max-h-[50vh] list-none flex-col overflow-auto p-0">
          {rows.map((r) => (
            <li key={r.appId} aria-label={displayTitle(r)} className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-fg">{displayTitle(r)}</span>
                <span className="truncate font-mono text-ui-sm text-fg-muted">{r.worktree?.path ?? r.directory}</span>
              </div>
              <button type="button" onClick={() => void unarchive(r.appId)} className={SECONDARY}>
                Unarchive
              </button>
              {r.worktree !== null && isManagedWorktree(r.worktree.path) && (
                <button type="button" onClick={() => openDialog({ kind: 'cleanup', target: cleanupTargetOf(r)! })} className={QUIET}>
                  Remove worktree…
                </button>
              )}
              <button type="button" onClick={() => openDialog({ kind: 'delete', appSessionId: r.appId })} className={QUIET}>
                Delete…
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows !== null && error && <p className="m-0 mt-2 text-ui-sm text-danger">{error}</p>}
    </Sheet>
  );
}
