// Whether another machine keeps each member's reading and drafts of its lane B sessions (P5 O8 M6a, docs/doperpowers/
// plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P; the architect's ruling 2 on `session.reader.update`): pinned,
// last seen and unread (`session.reader.update`, ./remote-reading.ts) and the composer's draft (`session.drafts.get` and
// `.set`, ./remote-drafts.ts), each the asking member's own on that machine's index, so they outlive this app's run.
//
// Learnt from the machine's answers, never assumed: an answer to any of the three says it keeps them (one endpoint build
// offers all three), and a `not-offered` (an endpoint older than M6a) that it doesn't, whose sessions keep this run's
// fallback (./read-marks.ts, `rememberingRemoteDrafts`) exactly as before. Until either is heard the machine is asked. A
// refusal is forgotten when the machine's feed opens again (`artifacts.resync`, ./remote-reading.ts), as the machines'
// other `not-offered` refusals are (../artifacts/remote-surfaces.ts): its endpoint may be newer now.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';

export type ReaderRows = 'kept' | 'refused';

const useReaderRows = create<{ machines: ReadonlyMap<MachineRef, ReaderRows> }>()(() => ({ machines: new Map() }));

export function resetReaderRows(): void {
  useReaderRows.setState({ machines: new Map() });
}

const machineOfSession = (appSessionId: AppSessionId): MachineRef | null => (isAddress(appSessionId) ? machineOf(appSessionId) : null);

/** What the session's machine was heard to do with its members' reading and drafts; null while not known. */
export const readerRowsOf = (appSessionId: AppSessionId): ReaderRows | null => {
  const machine = machineOfSession(appSessionId);
  return machine === null ? null : (useReaderRows.getState().machines.get(machine) ?? null);
};
export const useReaderRowsOf = (appSessionId: AppSessionId): ReaderRows | null =>
  useReaderRows((s) => {
    const machine = machineOfSession(appSessionId);
    return machine === null ? null : (s.machines.get(machine) ?? null);
  });

function learn(machine: MachineRef, rows: ReaderRows): void {
  useReaderRows.setState((s) => (s.machines.get(machine) === rows ? s : { machines: new Map(s.machines).set(machine, rows) }));
}

export const isNotOffered = (result: CommandResult<CommandName>): boolean => !result.ok && (result.error.issues as { refusal?: unknown } | undefined)?.refusal === 'not-offered';

/** The machine's answer to one of the three, heard: what it says of the machine; null for any other failure. */
export function heardReaderRows(appSessionId: AppSessionId, result: CommandResult<CommandName>): ReaderRows | null {
  const machine = machineOfSession(appSessionId);
  const rows: ReaderRows | null = result.ok ? 'kept' : isNotOffered(result) ? 'refused' : null;
  if (machine !== null && rows !== null) learn(machine, rows);
  return rows;
}

/** The machine's feed opened again: a refusal is asked afresh. */
export function forgetReaderRowsRefusal(machine: MachineRef): void {
  useReaderRows.setState((s) => {
    if (s.machines.get(machine) !== 'refused') return s;
    const machines = new Map(s.machines);
    machines.delete(machine);
    return { machines };
  });
}
