// A row's archived sessions (C10 execution document, Actions: `project.archived`): a dialog list, not a sidebar section
// (C5 hides archived rows and C10 adds none). Each row offers Unarchive (C4's `session.update`), Delete, and, for a
// session in a managed worktree, "Remove worktree…" (the cleanup dialog). P5 O6 M5: the list is the sidebar row's, by
// the row's own filing (`rowOfSession`): a project's org project, every checkout and folder it groups, read on each
// machine they are on that is up; with no project, a machine's own row (its menu names it; this machine's by default),
// its sessions of no project and of folders nobody opened there, titled by the machine's name.
import { useEffect, useMemo, useState } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { machineOf } from '@shared/machine/address';
import { machineKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { selectOffline, useMachines } from '../stores/machines';
import { machineName, machineOfRow, orgKeyOf, rowName, rowOfSession, rowProjects, selectOrgIndex, type RowKey } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';
import { isManagedWorktree } from './ArchiveDialog';
import { cleanupTargetOf } from './CleanupDialog';
import { openDialog } from './dialogs';
import { Sheet } from './Sheet';
import { QUIET, SECONDARY } from './ui';
import { displayTitle } from './title';

export function ArchivedSessionsDialog({ projectId, machine: named }: { projectId: ProjectId | null; machine?: MachineRef }) {
  const local = ipc.localMachine;
  const index = useSessions((s) => selectOrgIndex(s, local));
  const projects = useSessions((s) => s.projects);
  const machines = useMachines((s) => s.machines);
  const project = projectId === null ? undefined : projects.get(projectId);
  const row: RowKey = projectId === null ? machineKey(named ?? local) : project ? orgKeyOf(project) : machineKey(machineOf(projectId));
  // the machines the row's sessions are on: a machine's row its own, an org project's those of its projects that are up
  const own = machineOfRow(row);
  const readOn = own !== null ? own : [...new Set(rowProjects(index, row, (m) => !selectOffline({ machines }, m)).map((p) => machineOf(p.id)))].sort().join(' ');
  const title = rowName(index, row, (m) => machineName(machines, m, local)) ?? project?.name ?? '';
  const [lists, setLists] = useState<SessionRecord[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // read again after an unarchive

  useEffect(() => {
    let live = true;
    const reads = readOn === '' ? [] : readOn.split(' ').map((machine) => ipc.invoke('session.list', { includeArchived: true }, { machine: machine as MachineRef }));
    void Promise.all(reads).then((results) => {
      if (!live) return;
      const failed = results.find((result) => !result.ok);
      setError(failed && !failed.ok ? failed.error.message : null);
      if (failed && results.every((result) => !result.ok)) return;
      setLists(results.flatMap((result) => (result.ok ? [result.value.sessions] : [])));
    });
    return () => {
      live = false;
    };
  }, [readOn, version]);
  const listed = useMemo(() => new Set([row]), [row]);
  const rows = useMemo(
    () => lists?.flat().filter((r) => r.archived && rowOfSession(index, projects, r, listed) === row).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) ?? null,
    [lists, index, projects, listed, row],
  );

  const unarchive = async (appSessionId: AppSessionId) => {
    const result = await ipc.invoke('session.update', { appSessionId, patch: { archived: false } });
    if (!result.ok) setError(result.error.message);
    setVersion((v) => v + 1);
  };

  return (
    <Sheet title={`Archived sessions${title ? ` · ${title}` : ''}`} width="w-[min(560px,92vw)]">
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
