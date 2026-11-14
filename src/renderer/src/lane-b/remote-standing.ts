// What the window knows of a session's machine when it draws a control (the UX wave, U9; docs/doperpowers/plans/2026-11-
// 12-ux-wave-U9-other-machines.md, Interfaces §3's `RemoteStanding`): its name, its link's phase (app/machine-mark.ts),
// the capabilities its endpoint listed and whether the signed-in member is one of its owners, as the roster says. Only a
// session reached over RL2 has one: this Mac's sessions and a socket-linked machine's take no offer, so nothing here
// closes their controls. M3 reads it for the composer's Send and Stop in the offline phase.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { disabledWords, type RemoteStanding } from '@shared/ipc/remote-unavailable';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { linkPhaseNow, useLinkPhase } from '../app/machine-mark';
import { ipc } from '../ipc/client';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import { isOverRl2, useIsOverRl2 } from './remote-session';

const NONE = '' as MachineRef; // an id that names no machine: no roster entry, so the phase reads up
const machineOfSession = (appSessionId: AppSessionId): MachineRef | null => (isAddress(appSessionId) ? machineOf(appSessionId) : null);

/** The session's machine's standing now, or null for a session not reached over RL2. */
export function remoteStandingOf(appSessionId: AppSessionId): RemoteStanding | null {
  const machine = machineOfSession(appSessionId);
  if (machine === null || !isOverRl2(appSessionId)) return null;
  const entry = useMachines.getState().machines.get(machine);
  return { machine: machineName(useMachines.getState().machines, machine, ipc.localMachine), phase: linkPhaseNow(machine), capabilities: entry?.capabilities ?? null, owner: entry?.owner ?? null };
}

/** The same, followed in a render. */
export function useRemoteStanding(appSessionId: AppSessionId): RemoteStanding | null {
  const machine = machineOfSession(appSessionId);
  const remote = useIsOverRl2(appSessionId);
  const name = useMachines((s) => (machine === null ? '' : machineName(s.machines, machine, ipc.localMachine)));
  const phase = useLinkPhase(machine ?? NONE);
  const listed = useMachines((s) => (machine === null ? undefined : s.machines.get(machine)?.capabilities?.join('\n')));
  const owner = useMachines((s) => (machine === null ? null : (s.machines.get(machine)?.owner ?? null)));
  return useMemo(() => (remote && machine !== null ? { machine: name, phase, capabilities: listed === undefined ? null : listed.split('\n').filter(Boolean), owner } : null), [remote, machine, name, phase, listed, owner]);
}

/** UC-7.5's sentences for Send and Stop while the machine is offline; null in every other phase, and with no standing. */
export function offlineActs(standing: RemoteStanding | null): { send: string; stop: string } | null {
  if (standing?.phase !== 'offline') return null;
  return { send: disabledWords('session.send', standing) ?? '', stop: disabledWords('session.interrupt', standing) ?? '' };
}
