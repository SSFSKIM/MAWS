// A session tab's place (UX wave U13a; its section's "How a tab names its place", A9): the sidebar row the session sits
// under (`sessionRow`), named as the sidebar names it, and for a session on another machine that machine as the sidebar
// marks it (`@<name>`). Places are drawn only while the strip's session tabs, both panes together, are in more than one
// place, so a strip of one project on this Mac repeats nothing (l7-shell-05) and a mixed strip names every session's.
import type { TabRef } from '@shared/ipc/schema/layout';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { useSessionRows } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { useMachines } from '../stores/machines';
import { machineName, machineOfRow, rowName, selectOrgIndex, type OrgIndex, type RowKey } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';

// One session's place, or null for none: an unstarted chat with no project, a row with no name, and a session on this
// Mac before this Mac has answered. Before another machine has answered, its row is not known and the machine alone is
// the place. A machine's own row on another machine is its mark alone, which already names it.
function placeOf(row: RowKey | null | undefined, machine: MachineRef, local: MachineRef, index: OrgIndex, nameOf: (machine: MachineRef) => string): string | null {
  const mark = machine === local ? null : `@${nameOf(machine)}`;
  if (row === undefined || row === null) return row === undefined ? mark : null;
  if (mark !== null && machineOfRow(row) !== null) return mark;
  const name = rowName(index, row, nameOf);
  if (name === null) return mark;
  return mark === null ? name : `${name} ${mark}`;
}

/** Each session tab's place, by tab id, while the strip's session tabs are in more than one place; else null. */
export function useStripPlaces(): ReadonlyMap<string, string> | null {
  const main = useLayout((s) => s.main);
  const local = ipc.localMachine;
  const index = useSessions((s) => selectOrgIndex(s, local));
  const machines = useMachines((s) => s.machines);
  const sessionTabs = allTabs(main).filter((tab): tab is Extract<TabRef, { kind: 'session' }> => tab.kind === 'session');
  const rows = useSessionRows(sessionTabs.map((tab) => tab.appSessionId));
  const nameOf = (machine: MachineRef) => machineName(machines, machine, local);
  const places = new Map<string, string>();
  sessionTabs.forEach((tab, i) => {
    const place = placeOf(rows[i], machineOf(tab.appSessionId), local, index, nameOf);
    if (place !== null) places.set(tab.id, place);
  });
  return new Set(places.values()).size > 1 ? places : null;
}
