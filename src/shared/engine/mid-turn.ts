// Sessions whose process the engine host owns and that hold a turn, or are still launching (a first message on its way):
// the quit question's mid-turn count (P5 O3-C: shared, so main's read model, the spine's view in any backing and its test
// double count it alike). The engine status is the process table's truth; the digest is folded from events a stale batch
// can skew.
import type { EngineSessionStatus } from './status';

const LIVE = new Set<EngineSessionStatus['process']>(['starting', 'initializing', 'ready']);
const LAUNCHING = new Set<EngineSessionStatus['process']>(['starting', 'initializing']);

export function midTurnCountOf(statuses: Iterable<Pick<EngineSessionStatus, 'process' | 'turn'>>): number {
  let count = 0;
  for (const s of statuses) if (LIVE.has(s.process) && (s.turn !== null || LAUNCHING.has(s.process))) count += 1;
  return count;
}
