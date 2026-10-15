// What came of the last attempt to turn this device's notifications on or hand them to the hub — the start's resync,
// the grid banner's Turn on, the Notifications panel's own — kept for the panel, so a failure is shown there rather than
// dropped once the attempt's own view is gone.
import { create } from 'zustand';
import type { PushState } from './device';

/** The attempt's answer, or what it threw (the hub's refusal of its push key, before anything was subscribed). */
export type PushOutcome = { state: PushState } | { error: unknown };

export const usePushOutcome = create<{ outcome: PushOutcome | null }>()(() => ({ outcome: null }));

/** Keeps what `attempt` comes to, and answers it; an attempt answering null (nothing to resync) keeps nothing. */
export async function recordPushOutcome(attempt: Promise<PushState | null>): Promise<PushOutcome | null> {
  let outcome: PushOutcome | null;
  try {
    const state = await attempt;
    outcome = state && { state };
  } catch (error) {
    outcome = { error };
  }
  if (outcome) usePushOutcome.setState({ outcome });
  return outcome;
}

/**
 * The failure behind the device's `current` state that the last attempt saw and the state no longer carries: the
 * hub's refusal of this endpoint for an unsynced device, or what was thrown before a device that is still off could
 * subscribe. Null when there is none to show.
 */
export function failureBehind(current: PushState, outcome: PushOutcome | null): unknown {
  if (!outcome) return null;
  if (current.kind === 'unsynced' && current.error === null && 'state' in outcome && outcome.state.kind === 'unsynced' && outcome.state.endpoint === current.endpoint) return outcome.state.error;
  if (current.kind === 'off' && 'error' in outcome) return outcome.error;
  return null;
}
