// Journal replay through C3's `Normalizer` (src/engine-host/normalizer.ts; C4 execution document, "Replay engine"):
// one fresh normaliser per run behind the runner's `RowNormalizer`, keyed by the run's own ids (the rewritten session
// id, the run's app id, and the run id as its launch id), so a replayed journal becomes the events a live session with
// those frames would have produced.
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { Normalizer } from '../../normalizer';
import type { RowNormalizer } from './runner';

export function engineNormalizer(sessionId: SessionId, appSessionId: AppSessionId): RowNormalizer {
  const normalizer = new Normalizer({ appSessionId, launchId: sessionId, sessionId });
  return { normalize: (row) => normalizer.push(row) };
}
