// A machine link's display phase (the UX wave, U9; O-39; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md,
// Interfaces §7 and the Decision Log's ruling of 2026-11-13 that a Needs you item greys by it): one pure rule from the
// roster's fields, read by the window (app/machine-mark.ts, which keeps the hook and the words) and by main's attention
// of other machines (src/main/lane-b/remote-attention.ts), so the count, the dock badge and a row's words agree.
import type { LinkPhase } from '../ipc/remote-unavailable';
import type { MachineState } from '../ipc/schema/machines';
import { REMOTE_ACT_PENDING_MS } from './remote-pending';

/**
 * O-39's table, from the roster entry: `connecting` until the link's first answer; `down` with the machine's removal,
 * removed; `down` within a minute (the hold an act gets) of a link that was up earlier in this run (`generation > 0`),
 * reconnecting; any other `down`, offline. A machine the roster does not name, and this Mac: up.
 */
export function phaseOf(entry: Pick<MachineState, 'state' | 'since' | 'generation' | 'refusal'> | undefined, now: number): LinkPhase {
  if (entry === undefined || entry.state === 'up') return 'up';
  if (entry.state === 'connecting') return 'connecting';
  if (entry.refusal === 'removed') return 'removed';
  return entry.generation > 0 && now - Date.parse(entry.since) < REMOTE_ACT_PENDING_MS ? 'reconnecting' : 'offline';
}

/** Whether a machine in `phase` is shown offline: greyed, and its items out of every count. */
export const showsOffline = (phase: LinkPhase): boolean => phase === 'offline' || phase === 'removed';
