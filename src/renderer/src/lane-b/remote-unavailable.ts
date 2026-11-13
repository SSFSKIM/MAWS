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
//
// The UX wave, U9 (M4; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §4; UC-7.5): for such a
// session the answer is `disabledWords` for the first command that yields a sentence, the machine's standing read from the
// roster and the link's phase (./remote-standing.ts): a declared command's words; an offered act its build doesn't list
// the capability for; an act with words while the machine is offline; a menu act while it connects or reconnects; Fork
// for a member known not to own the machine. Then the older peer's rule, for a command outside `REMOTE_NEEDS` alone (a
// command behind a capability is said by the capability). Every control for an act on a session reads this and nothing
// else; test/lane-b/renderer-guards.test.ts holds the renderer to it.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { disabledWords, REMOTE_NEEDS, type RemoteStanding } from '@shared/ipc/remote-unavailable';
import type { CommandName } from '@shared/ipc/schema';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { REMOTE_ACTION_COMMAND, type SessionActionId } from '../app/session-actions';
import { heardNotOffered, notOfferedRefusals, REMOTE_SURFACE_WORDS, useNotOfferedRefusals } from '../artifacts/remote-surfaces';
import { isWorking } from '../sessions/listed-state';
import { useSessions } from '../stores/sessions';
import { useIsOverRl2 } from './remote-session';
import { remoteStandingOf, useRemoteStanding } from './remote-standing';

/** UC-7.5's Fork while the session's turn runs: the composer's own words (composer/InlineEdit.tsx `BUSY_REASON`). */
export const TURN_RUNS = 'Wait for the turn to end, or stop it first';

function unavailableIn(standing: RemoteStanding | null, machine: MachineRef | null, refused: ReadonlySet<string>, commands: readonly CommandName[], label?: string): string | null {
  if (standing === null || machine === null) return null;
  for (const command of commands) {
    const words = disabledWords(command, standing, label);
    if (words !== null) return words;
  }
  const older = commands.some((command) => REMOTE_NEEDS[command] === undefined && heardNotOffered(refused, machine, command));
  return older ? REMOTE_SURFACE_WORDS.notOffered(standing.machine) : null;
}

const NONE = '' as AppSessionId; // no session: no machine's, so nothing greyed
const machineOfSession = (appSessionId: AppSessionId): MachineRef | null => (isAddress(appSessionId) ? machineOf(appSessionId) : null);

/** Why a control issuing `commands` for the session is greyed, read now; null when it isn't. */
export function remoteUnavailableOf(appSessionId: AppSessionId | null, ...commands: CommandName[]): string | null {
  const id = appSessionId ?? NONE;
  return unavailableIn(remoteStandingOf(id), machineOfSession(id), notOfferedRefusals(), commands);
}

function useUnavailable(label: string | undefined, appSessionId: AppSessionId | null, commands: readonly CommandName[]): string | null {
  const id = appSessionId ?? NONE;
  const standing = useRemoteStanding(id);
  const refused = useNotOfferedRefusals();
  return unavailableIn(standing, machineOfSession(id), refused, commands, label);
}

/** The same, followed in a render. */
export function useRemoteUnavailable(appSessionId: AppSessionId | null, ...commands: CommandName[]): string | null {
  return useUnavailable(undefined, appSessionId, commands);
}

/** The same answer for a control whose label is not the command's act ("Edit" and "Delete" over `session.steer.cancel`). */
export function useRemoteUnavailableAs(label: string, appSessionId: AppSessionId | null, ...commands: CommandName[]): string | null {
  return useUnavailable(label, appSessionId, commands);
}

/**
 * Why Fork is disabled for a session on another machine, or null: the answer above for `session.fork`, then the turn's
 * words while the one reader of its state says it works (sessions/listed-state.ts). Null for a session on this Mac, where
 * Fork is unchanged.
 */
export function useForkUnavailable(appSessionId: AppSessionId | null): string | null {
  const id = appSessionId ?? NONE;
  const words = useRemoteUnavailable(appSessionId, 'session.fork');
  const remote = useIsOverRl2(id);
  const working = useSessions((s) => isWorking(s.digests.get(id), s.listed.get(id)));
  if (!remote) return null;
  return words ?? (working ? TURN_RUNS : null);
}

/** Why a session menu's item is drawn disabled for a session on another machine: the helper asked about the command the
 * action issues there (`REMOTE_ACTION_COMMAND`), Fork by `useForkUnavailable`; null for an action that issues none. */
export function useSessionActionUnavailable(id: SessionActionId, appSessionId: AppSessionId): string | null {
  const commands = useMemo(() => {
    const command = id === 'fork' ? undefined : REMOTE_ACTION_COMMAND[id];
    return command === undefined ? [] : [command];
  }, [id]);
  const fork = useForkUnavailable(id === 'fork' ? appSessionId : null);
  const other = useUnavailable(undefined, appSessionId, commands);
  return id === 'fork' ? fork : other;
}
