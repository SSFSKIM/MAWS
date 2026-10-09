// P2-A (2026-10-09; X16, the execution document §5.2): a session's availability in the renderer. Main derives it and
// carries it on the digest; the engine status may arrive before the digest that follows it, so a ready or launching
// status answers first. A known record with no digest yet is resumable; an id with neither (an unstarted intent, which
// C10's setup owns) answers null.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { Availability } from '@shared/ipc/schema/session';
import { useSessions, type SessionsState } from '../stores/sessions';

const LAUNCHING = new Set<EngineSessionStatus['process']>(['starting', 'initializing']);

export function availabilityIn(s: Pick<SessionsState, 'engine' | 'digests' | 'records'>, appSessionId: AppSessionId): Availability | null {
  const process = s.engine.get(appSessionId)?.process;
  if (process === 'ready') return 'usable';
  const digest = s.digests.get(appSessionId)?.availability;
  if (process !== undefined && LAUNCHING.has(process) && digest !== 'archived') return 'starting';
  if (digest !== undefined) return digest;
  return s.records.has(appSessionId) ? 'resumable' : null;
}

export function useAvailability(appSessionId: AppSessionId): Availability | null {
  return useSessions((s) => availabilityIn(s, appSessionId));
}
