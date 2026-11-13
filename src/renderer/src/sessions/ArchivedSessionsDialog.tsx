// A row's archived sessions (C10 execution document, Actions: `project.archived`): a dialog list, not a sidebar section
// (C5 hides archived rows and C10 adds none). Each row offers Unarchive (C4's `session.update`), Delete, and, for a
// session in a managed worktree, "Remove worktree…" (the cleanup dialog). P5 O6 M5: the list is the sidebar row's, by
// the row's own filing (`rowOfSession`): a project's org project, every checkout and folder it groups, read on each
// machine they are on that is up; with no project, a machine's own row (its menu names it; this machine's by default),
// its sessions of no project and of folders nobody opened there, titled by the machine's name.
// The UX wave, U9 (S-02, A9, A14): a machine reached over RL2 is asked only while its link is up and its build lists
// `rl2.session-acts` (it answers the archived read cut to what the member may manage); any other says why as that
// machine's line (UC-7.5's words for "list archived sessions", else the link's phase) and is asked nothing. Unarchive there
// returns the session to this sidebar at once (the sessions store's `noteUnarchived`); removing a worktree there is not
// offered.
import { useEffect, useMemo, useState } from 'react';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { machineOf } from '@shared/machine/address';
import { machineKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { disabledWords, REMOTE_NEEDS } from '@shared/ipc/remote-unavailable';
import type { MachineState } from '@shared/ipc/schema/machines';
import { phaseOf, phaseWords, usePhaseClock } from '../app/machine-mark';
import { useRemoteUnavailable } from '../lane-b/remote-unavailable'; // P5 O7 M8
import { useIsOverRl2 } from '../lane-b/remote-session';
import { useMachines } from '../stores/machines';
import { machineName, machineOfRow, rowName, rowOfSession, rowProjects, selectOrgIndex, type OrgIndex, type RowKey } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';
import { isManagedWorktree } from './ArchiveDialog';
import { cleanupTargetOf } from './CleanupDialog';
import { openDialog } from './dialogs';
import { onAnotherMachine } from './record-ops';
import { Sheet } from './Sheet';
import { QUIET, SECONDARY } from './ui';
import { displayTitle } from './title';

export function ArchivedSessionsDialog({ projectId, machine: named }: { projectId: ProjectId | null; machine?: MachineRef }) {
  const local = ipc.localMachine;
  const index = useSessions((s) => selectOrgIndex(s, local));
  const projects = useSessions((s) => s.projects);
  const machines = useMachines((s) => s.machines);
  const rl2 = useSessions((s) => s.listedMachines); // the UX wave, U9: the machines reached over RL2
  const now = usePhaseClock();
  const project = projectId === null ? undefined : projects.get(projectId);
  const row: RowKey = projectId === null ? machineKey(named ?? local) : project ? index.keyOf(project) : machineKey(machineOf(projectId));
  const { readOn, lines } = readsOf(index, row, local, rl2, machines, now);
  const title = rowName(index, row, (m) => machineName(machines, m, local)) ?? project?.name ?? '';
  const [lists, setLists] = useState<SessionRecord[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // read again after an unarchive

  useEffect(() => {
    let live = true;
    if (readOn === '') return;
    const reads = readOn.split(' ').map((machine) => ipc.invoke('session.list', { includeArchived: true }, { machine: machine as MachineRef }));
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
    else if (onAnotherMachine(appSessionId)) useSessions.getState().noteUnarchived(appSessionId); // the UX wave, U9
    setVersion((v) => v + 1);
  };

  return (
    <Sheet title={`Archived sessions${title ? ` · ${title}` : ''}`} width="w-[min(560px,92vw)]">
      {rows === null ? (
        (error !== null || readOn !== '') && <p className="m-0 text-fg-muted">{error ?? 'Loading…'}</p>
      ) : rows.length === 0 ? (
        lines.length === 0 && <p className="m-0 text-fg-muted">No archived sessions.</p>
      ) : (
        <ul aria-label="Archived sessions" className="m-0 flex max-h-[50vh] list-none flex-col overflow-auto p-0">
          {rows.map((r) => (
            <ArchivedRow key={r.appId} record={r} onUnarchive={() => void unarchive(r.appId)} />
          ))}
        </ul>
      )}
      {rows !== null && error && <p className="m-0 mt-2 text-ui-sm text-danger">{error}</p>}
      {lines.map((line) => (
        <p key={line} data-machine-line className="m-0 mt-2 text-ui-sm text-fg-muted">
          {line}
        </p>
      ))}
    </Sheet>
  );
}

// P5 O7 M8: deleting a session of a machine reached over RL2 is declared not offered there (lane-b/remote-unavailable.ts):
// the button stays, greyed with the declared words. The UX wave, U9: Unarchive is offered there, behind the capability.
function ArchivedRow({ record: r, onUnarchive }: { record: SessionRecord; onUnarchive(): void }) {
  const unarchiveUnavailable = useRemoteUnavailable(r.appId, 'session.update');
  const deleteUnavailable = useRemoteUnavailable(r.appId, 'session.delete');
  const elsewhere = useIsOverRl2(r.appId); // the UX wave, U9: removing a worktree on another machine is not offered
  return (
    <li aria-label={displayTitle(r)} className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-fg">{displayTitle(r)}</span>
        <span className="truncate font-mono text-ui-sm text-fg-muted">{r.worktree?.path ?? r.directory}</span>
      </div>
      <button type="button" onClick={onUnarchive} disabled={unarchiveUnavailable !== null} title={unarchiveUnavailable ?? undefined} className={SECONDARY}>
        Unarchive
      </button>
      {!elsewhere && r.worktree !== null && isManagedWorktree(r.worktree.path) && (
        <button type="button" onClick={() => openDialog({ kind: 'cleanup', target: cleanupTargetOf(r)! })} className={QUIET}>
          Remove worktree…
        </button>
      )}
      <button type="button" onClick={() => openDialog({ kind: 'delete', appSessionId: r.appId })} disabled={deleteUnavailable !== null} title={deleteUnavailable ?? undefined} className={QUIET}>
        Delete…
      </button>
    </li>
  );
}

/**
 * The machines a row's archived sessions are read on, as one string for the effect, and the line said for each machine
 * not asked: a machine's row its own, an org project's those its projects are on (the UX wave, U9: `askOf`).
 */
function readsOf(index: OrgIndex, row: RowKey, local: MachineRef, rl2: ReadonlySet<MachineRef>, machines: ReadonlyMap<MachineRef, MachineState>, now: number): { readOn: string; lines: string[] } {
  const own = machineOfRow(row);
  const on = own !== null ? [own] : [...new Set(rowProjects(index, row, () => true).map((p) => machineOf(p.id)))].sort();
  const plans = on.map((machine) => askOf(machine, local, rl2.has(machine), machines, now));
  return {
    readOn: on.filter((_, i) => plans[i] === 'ask').join(' '),
    lines: plans.flatMap((plan) => (plan !== null && plan !== 'ask' ? [plan.line] : [])),
  };
}

/**
 * Whether the archived read is asked of `machine`, or the line said in its place (the UX wave, U9): this Mac, and a
 * machine whose sessions take the manager's path while it is not offline, are asked as before; a machine reached over RL2
 * only while its link is up and its build lists the read's capability. Null: neither (a socket-linked machine that is down).
 */
function askOf(machine: MachineRef, local: MachineRef, rl2: boolean, machines: ReadonlyMap<MachineRef, MachineState>, now: number): 'ask' | { line: string } | null {
  if (machine === local) return 'ask';
  const entry = machines.get(machine);
  if (!rl2) return entry !== undefined && entry.state !== 'up' ? null : 'ask'; // selectOffline's rule
  const phase = phaseOf(entry, now);
  const capabilities = entry?.capabilities ?? null;
  const needs = REMOTE_NEEDS['session.list'];
  if (phase === 'up' && needs !== undefined && capabilities?.includes(needs) === true) return 'ask';
  const name = machineName(machines, machine, local);
  const line = disabledWords('session.list', { machine: name, phase, capabilities, owner: entry?.owner ?? null }, 'list archived sessions') ?? phaseWords(phase, name);
  return line === null ? null : { line };
}
