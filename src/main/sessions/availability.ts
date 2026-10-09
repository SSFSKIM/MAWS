// P2-A (2026-10-09; X16, the P2-A execution document §5.2): what an action can do with a session now, apart from the
// engine host's process status. Pure and IO-free: the record's archive flag and C4's projected holder (advisory; the
// guards re-read the registry fresh and fail closed), C3's status, and main's acquisition memory for this app run. First
// match wins. An exited process is `resumable` whatever ended it (a crash, the memory budget, the idle clock): only
// MAWS's own last attempt in this app run makes a session `failed`, `needs_trust` or `missing_directory`, and the next
// attempt clears that.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { Availability } from '@shared/ipc/schema/session';

// Main's in-memory acquisition state for one session (D-16: never persisted): whether an acquisition, a start or a
// take-over of it is in flight, and what the last acquisition in this app run ended with when it did not end ready.
export interface AcquisitionMemory {
  inFlight: boolean;
  last: { kind: 'needs_trust' | 'missing_directory' | 'failed'; at: string; message: string | null } | null;
}

const LAUNCHING = new Set<EngineSessionStatus['process']>(['starting', 'initializing']);

export function availabilityOf(record: SessionRecord, status: EngineSessionStatus | null, memory: AcquisitionMemory | null): Availability {
  if (record.archived) return 'archived';
  if (status?.process === 'ready') return 'usable'; // W7's contested `self` included: MAWS's own process is ready
  if (memory?.inFlight || (status !== null && LAUNCHING.has(status.process))) return 'starting';
  if (record.holder.kind === 'terminal' || record.holder.kind === 'background_job') return 'foreign_held';
  if (memory?.last) return memory.last.kind;
  return 'resumable';
}
