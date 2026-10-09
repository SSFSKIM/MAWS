// P2-A (2026-10-09; X16, the execution document §5.2): a session's availability in the renderer. Main derives it and
// carries it on the digest; the engine status may arrive before the digest that follows it, so a ready or launching
// status answers first. A known record with no digest yet is resumable; an id with neither (an unstarted intent, which
// C10's setup owns) answers null.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { Availability } from '@shared/ipc/schema/session';
import { ARCHIVED, NOT_YET } from '../composer/submit/submit-state';
import { useSessions, type SessionsState } from '../stores/sessions';
import { holderWords } from './holder-words';

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

// P2-A M3 (2026-10-09; the execution document §5.6): why an owner's gesture cannot start this session, in words, or
// null when it may (a chip choice, a Load now or a Refresh acquires it). A terminal or a job holding it is named; an
// archive says how to continue; an id nothing has started (an unstarted tab's) waits for its first message.
export function availabilityRefusal(availability: Availability | null, holder: SessionRecord['holder'] | null): string | null {
  if (availability === 'archived') return ARCHIVED;
  if (availability === 'foreign_held') return `Held by ${holderWords(holder ?? { kind: 'none' })}`;
  if (availability === null) return NOT_YET;
  return null;
}
