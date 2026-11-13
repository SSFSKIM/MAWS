// Why a session control is greyed for a session on another machine (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-
// remote-lane-b.md, "The offer audit and its contract"; Interfaces §U, `REMOTE_UNAVAILABLE`). The one helper every
// session surface's controls read (the question panel, the side panels, the widgets, Session info), so no control keeps
// its own copy of the rule:
//
// - a command the shared set declares not offered on another machine (@shared/ipc/remote-unavailable.ts) is greyed with
//   that entry's words, and nothing is asked;
// - "An older peer": a command a machine was heard refusing `not-offered` (an older build serves no row for it; the
//   refusals are heard app-wide, ../artifacts/remote-surfaces.ts) is greyed with "<machine> doesn’t offer this" until that
//   machine's feed opens again.
//
// Only a session reached over RL2 on another machine is greyed (`isOverRl2`), lane B's or lane A's (lane A's adapter takes
// only `laneA.*`): this Mac's sessions, and those of a machine whose sessions take the manager's path, reach every command.
import type { AppSessionId } from '@shared/graph/ids';
import { REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';
import type { CommandName } from '@shared/ipc/schema';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { heardNotOffered, notOfferedRefusals, REMOTE_SURFACE_WORDS, useNotOfferedRefusals } from '../artifacts/remote-surfaces';
import { ipc } from '../ipc/client';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import { isOverRl2, useIsOverRl2 } from './remote-session';

/**
 * UX wave U9, M1's bridge (docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Decision Log: "M1's bridge in
 * the window's helper, a seam M4 removes"). M1 offers these six acts at the other machine's endpoint and takes them out of
 * `REMOTE_UNAVAILABLE`, before any control of the window guards them; until M4 mounts those guards, a session reached over
 * RL2 keeps them greyed here with the words the declared set gave them. M4 deletes this list, its answer read from the
 * offers instead.
 */
export const ACTS_UNTIL_M4: Readonly<Partial<Record<CommandName, string>>> = {
  'session.archive': 'Not on another machine yet: archiving a session',
  'session.update': 'Not on another machine yet: archiving a session or changing its title',
  'session.rename': 'Not on another machine yet: renaming a session',
  'attention.acknowledge': 'Not on another machine yet: dismissing an error from here',
  'session.steer.cancel': 'Not on another machine yet: taking back a message the agent hasn’t started',
  'maws.pane.answer': 'Not on another machine yet: mod surfaces',
};

interface Facts {
  remote: boolean; // a session on another machine, reached over RL2
  machine: MachineRef | null; // its machine (null: an id that names none)
  name: string; // that machine's name, for the words
  refused: ReadonlySet<string>; // the `not-offered` refusals heard
}

function unavailableIn({ remote, machine, name, refused }: Facts, commands: readonly CommandName[]): string | null {
  if (!remote || machine === null) return null;
  for (const command of commands) {
    const words = REMOTE_UNAVAILABLE[command] ?? ACTS_UNTIL_M4[command];
    if (words !== undefined) return words;
  }
  return commands.some((command) => heardNotOffered(refused, machine, command)) ? REMOTE_SURFACE_WORDS.notOffered(name) : null;
}

const NONE = '' as AppSessionId; // no session: no machine's, so nothing greyed
const machineOfSession = (appSessionId: AppSessionId): MachineRef | null => (isAddress(appSessionId) ? machineOf(appSessionId) : null);

/** Why a control issuing `commands` for the session is greyed, read now; null when it isn't. */
export function remoteUnavailableOf(appSessionId: AppSessionId | null, ...commands: CommandName[]): string | null {
  const id = appSessionId ?? NONE;
  const machine = machineOfSession(id);
  const name = machine === null ? '' : machineName(useMachines.getState().machines, machine, ipc.localMachine);
  return unavailableIn({ remote: isOverRl2(id), machine, name, refused: notOfferedRefusals() }, commands);
}

/** The same, followed in a render. */
export function useRemoteUnavailable(appSessionId: AppSessionId | null, ...commands: CommandName[]): string | null {
  const id = appSessionId ?? NONE;
  const remote = useIsOverRl2(id);
  const refused = useNotOfferedRefusals();
  const machine = machineOfSession(id);
  const name = useMachines((s) => (machine === null ? '' : machineName(s.machines, machine, ipc.localMachine)));
  return unavailableIn({ remote, machine, name, refused }, commands);
}
