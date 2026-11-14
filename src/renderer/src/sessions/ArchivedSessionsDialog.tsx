// A row's archived sessions (C10 execution document, Actions: `project.archived`): a dialog list, not a sidebar section
// (C5 hides archived rows and C10 adds none). Each row offers Unarchive (C4's `session.update`), Delete, and, for a
// session in a managed worktree, "Remove worktree…" (the cleanup dialog). P5 O6 M5: the list is the sidebar row's, by
// the row's own filing (`rowOfRecord`): a project's org project, every checkout and folder it groups, read on each
// machine they are on that is up; with no project, a machine's own row (its menu names it; this machine's by default),
// its sessions of no project and of folders nobody opened there, titled by the machine's name.
// The UX wave, U9 (S-02, A9, A14): a machine reached over RL2 is asked only while its link is up and its build lists
// `rl2.session-acts` (it answers the archived read cut to what the member may manage); any other says why as that
// machine's line (UC-7.5's words for "list archived sessions", else the link's phase) and is asked nothing. Unarchive there
// returns the session to this sidebar at once (the sessions store's `noteUnarchived`); removing a worktree there is not
// offered.
// The UX wave, U9 (the architect's ruling (A) of 2026-11-13; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-
// machines.md, Decision Log): the footer's sheet (no project, no machine named) reaches every machine's own row, since a
// machine's row leaves the sidebar with its last listed session and its menu with it: this Mac's section first, then
// one under each other machine's name, each asked as the sheet opens or worded by the rules above. No machine waits for
// another: each section shows its rows, its line or that it is loading; a machine with nothing archived there shows
// none, and this Mac's keeps "No archived sessions.". With no other machine in the roster the sheet is as before.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { machineName, machineOfRow, rowName, rowOfRecord, rowProjects, selectOrgIndex, type OrgIndex, type RowKey } from '../stores/org-projects';
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
  const everyMachine = useMachines((s) => projectId === null && named === undefined && [...s.machines.keys()].some((machine) => machine !== local));
  return everyMachine ? <EveryMachineSheet /> : <RowSheet projectId={projectId} named={named} />;
}

/** A row's archived sessions, read on the machines `readOn` names (space-separated; none for ''), and their Unarchive. */
function useArchived(row: RowKey, readOn: string) {
  const local = ipc.localMachine;
  const index = useSessions((s) => selectOrgIndex(s, local));
  const projects = useSessions((s) => s.projects);
  const listedNow = useSessions((s) => s.listed); // ticket 644: another machine's record is the row's its listing files it under
  // the UX wave, U9: a session this window archived keeps the listing it had at the act (`acted`), so it stays under the
  // row it sat under before the archive once its listing leaves the store, whenever the registry places its folder here
  const acted = useSessions((s) => s.acted);
  const listings = useMemo(() => {
    const kept = [...acted].flatMap(([id, note]) => (note.archived && note.hidden !== null && !listedNow.has(id) ? [[id, note.hidden] as const] : []));
    return kept.length === 0 ? listedNow : new Map([...listedNow, ...kept]);
  }, [listedNow, acted]);
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
    () => lists?.flat().filter((r) => r.archived && rowOfRecord(index, projects, r, listings, listed) === row).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) ?? null,
    [lists, index, projects, listings, listed, row],
  );

  const unarchive = async (appSessionId: AppSessionId) => {
    const result = await ipc.invoke('session.update', { appSessionId, patch: { archived: false } });
    if (!result.ok) setError(result.error.message);
    else if (onAnotherMachine(appSessionId)) useSessions.getState().noteUnarchived(appSessionId); // the UX wave, U9
    setVersion((v) => v + 1);
  };
  return { rows, error, unarchive };
}

/** One row's sheet: a project's, or a machine's own row (its menu names it; this Mac's from the footer with no other machine). */
function RowSheet({ projectId, named }: { projectId: ProjectId | null; named: MachineRef | undefined }) {
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
  const { rows, error, unarchive } = useArchived(row, readOn);

  return (
    <Sheet title={`Archived sessions${title ? ` · ${title}` : ''}`} width="w-[min(560px,92vw)]">
      {rows === null ? (
        (error !== null || readOn !== '') && <p className="m-0 text-fg-muted">{error ?? 'Loading…'}</p>
      ) : rows.length === 0 ? (
        <NoneArchived saidElsewhere={lines.length > 0} />
      ) : (
        <ArchivedList label="Archived sessions" rows={rows} onUnarchive={unarchive} />
      )}
      {rows !== null && error && <p className="m-0 mt-2 text-ui-sm text-danger">{error}</p>}
      <MachineLines lines={lines} />
    </Sheet>
  );
}

/** The UX wave, U9 (ruling (A)): the footer's sheet with another machine in the roster: each machine's own row, this Mac's first. */
function EveryMachineSheet() {
  const local = ipc.localMachine;
  const machines = useMachines((s) => s.machines);
  const rl2 = useSessions((s) => s.listedMachines);
  const now = usePhaseClock();
  const order = [local, ...[...machines.keys()].filter((machine) => machine !== local)];
  return (
    <Sheet title="Archived sessions" width="w-[min(560px,92vw)]">
      <div className="flex max-h-[60vh] flex-col overflow-auto">
        {order.map((machine) => (
          <MachineSection key={machine} machine={machine} name={machineName(machines, machine, local)} plan={askOf(machine, local, rl2.has(machine), machines, now)} />
        ))}
      </div>
    </Sheet>
  );
}

/** One machine's own row in the footer's sheet: its rows, its line, its loading, or nothing when it has none archived. */
function MachineSection({ machine, name, plan }: { machine: MachineRef; name: string; plan: ReturnType<typeof askOf> }) {
  const here = machine === ipc.localMachine;
  const { rows, error, unarchive } = useArchived(machineKey(machine), plan === 'ask' ? machine : '');
  if (plan === null) return null;
  let body: ReactNode;
  if (plan !== 'ask') body = <MachineLines lines={[plan.line]} />;
  else if (rows === null) body = <p className="m-0 text-fg-muted">{error ?? 'Loading…'}</p>;
  else if (rows.length === 0 && !here && error === null) return null;
  else
    body = (
      <>
        {rows.length === 0 ? <NoneArchived saidElsewhere={false} /> : <ArchivedList label={`Archived sessions on ${name}`} rows={rows} onUnarchive={unarchive} />}
        {error && <p className="m-0 mt-2 text-ui-sm text-danger">{error}</p>}
      </>
    );
  return (
    <section aria-label={name} className="mb-3 last:mb-0">
      <h3 className="m-0 mb-1 text-ui-sm font-medium text-fg-muted">{name}</h3>
      {body}
    </section>
  );
}

function ArchivedList({ label, rows, onUnarchive }: { label: string; rows: SessionRecord[]; onUnarchive(appSessionId: AppSessionId): Promise<void> }) {
  return (
    <ul aria-label={label} className="m-0 flex max-h-[50vh] list-none flex-col overflow-auto p-0">
      {rows.map((r) => (
        <ArchivedRow key={r.appId} record={r} onUnarchive={() => void onUnarchive(r.appId)} />
      ))}
    </ul>
  );
}

// The UX wave, U9: the line of each machine the archived read was not asked of.
function MachineLines({ lines }: { lines: readonly string[] }) {
  return lines.map((line) => (
    <p key={line} data-machine-line className="m-0 mt-2 text-ui-sm text-fg-muted">
      {line}
    </p>
  ));
}

// "No archived sessions." unless a machine's line says why it wasn't asked.
const NoneArchived = ({ saidElsewhere }: { saidElsewhere: boolean }) => (saidElsewhere ? null : <p className="m-0 text-fg-muted">No archived sessions.</p>);

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
