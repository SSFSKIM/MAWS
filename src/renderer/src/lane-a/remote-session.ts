// Another machine's terminal session (P5 O9 M9, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §G): a row
// O8 lists from that machine's signed listing whose lane is A (R2: the lane picks the transport, the lane A port and the
// plane source, never which controls are drawn). Its address is `<machine ref>/<engine session id>` (R1). It has no
// record: its state comes only from the page's watch (main's remote adapter answers `laneA.watch` over the machine's
// link), so before the watch's first state it reads as starting.
import type { AppSessionId } from '@shared/graph/ids';
import type { LaneAState } from '@shared/ipc/schema/lane-a';
import { bareOf, machineOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { useMachines } from '../stores/machines';
import { machineName } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';

export const isRemoteLaneA = (appSessionId: AppSessionId): boolean => useSessions.getState().listed.get(appSessionId)?.lane === 'A';
export const useRemoteLaneA = (appSessionId: AppSessionId | null): boolean => useSessions((s) => appSessionId !== null && s.listed.get(appSessionId)?.lane === 'A');

/** What the session's machine is called, as its rows name it. */
export const remoteMachineName = (appSessionId: AppSessionId): string => machineName(useMachines.getState().machines, machineOf(appSessionId), ipc.localMachine);

/** 2026-11-06: what the session's machine's endpoint listed in its handshake (MachineState's `capabilities`); null while no channel says. */
export const remoteMachineCapabilities = (appSessionId: AppSessionId): readonly string[] | null => useMachines.getState().machines.get(machineOf(appSessionId))?.capabilities ?? null;
/** The same, for a component: subscribed, so a channel's coming up (its list known) renders again. */
export const useRemoteMachineCapabilities = (appSessionId: AppSessionId): string =>
  useMachines((s) => (s.machines.get(machineOf(appSessionId))?.capabilities ?? null)?.join(',') ?? '');

/** The state a remote session reads as before its watch's first: starting, every control closed with why. */
export function startingRemoteState(appSessionId: AppSessionId): LaneAState {
  return {
    appSessionId,
    engineSessionId: bareOf(appSessionId),
    bridge: 'starting',
    reason: `Reading the session from ${remoteMachineName(appSessionId)}`,
    launch: null,
    sminos: null,
    ops: [],
    reads: [],
    controls: {},
    turn: { running: false, unknown: false },
    model: null,
    effort: null,
    override: null,
    mode: null,
    catalog: null,
    pending: [],
    settled: [],
    deliveries: [],
  };
}
