// The Org page's Machines group (P5 O8 M4a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, *Machines in
// M4a*): read-only. Each machine the held head lists, by its signed name, with its owners by name (you as "you", the
// org's as the org's, an id the head no longer lists as a former member) and whether it is up. Up is the renderer's
// `useMachines` store, which `machines.changed` keeps current, never the view: a link can drop with no new head. Enrolling
// is still the deployment admin's command; its edits, grants and enrollment are M4b's.
import type { MachineState } from '@shared/ipc/schema/machines';
import type { OrgView } from '@shared/ipc/schema/org';
import type { MachineRef } from '@shared/machine/ref';
import { useMachines } from '../../stores/machines';
import { ORG } from '../copy';
import { Setting } from '../parts';
import { inWords } from './parts';

type Linked = MachineState['state'] | 'unknown';

export function MachinesGroup({ view }: { view: OrgView }) {
  const states = useMachines((s) => s.machines);
  const owners = (owned: OrgView['machines'][number]['owners']): string => {
    if (owned === 'org') return ORG.ownedByOrg;
    const names = owned.map((id) => {
      const member = view.members.find((m) => m.id === id);
      return member === undefined ? ORG.formerMember : member.you ? ORG.youMark : member.name;
    });
    return ORG.ownedBy(inWords(names));
  };
  return (
    <>
      {view.machines.length === 0 && <p className="m-0 py-1 text-ui-sm text-fg-muted">{ORG.noMachines}</p>}
      {view.machines.map((machine) => {
        const linked: Linked = states.get(machine.ref as MachineRef)?.state ?? 'unknown';
        return (
          <Setting key={machine.ref} label={machine.name}>
            <span className={linked === 'up' ? 'text-fg' : 'text-fg-muted'}>{ORG.machineState[linked]}</span>
            <span className="text-fg-muted">{owners(machine.owners)}</span>
          </Setting>
        );
      })}
      <Setting label={ORG.enroll} note={ORG.enrollNote}>
        <span className="font-mono text-fg select-all">{ORG.enrollCommand}</span>
      </Setting>
    </>
  );
}
