// A lane A session's jobs for the jobs list and its summary (P5 O9 M5): its background shells and monitors as main
// derives them from its transcript, carried by the page's watch (./../watches.ts keeps them in the lane A store). While
// the session is driven through its bridge the caller holds the watch; past that, the store keeps the last jobs only when
// none still runs (`laneAJobsWatchEnded`), so an ended session's list reads them exited.
import { useEffect } from 'react';
import type { Job } from 'desk-hub/protocol';
import type { AppSessionId } from '@shared/graph/ids';
import { useLaneAJobs } from '../../stores/lane-a';
import { watchLaneA } from '../watches';

// The session's jobs, null while no watch of this page has carried any.
export function useDrivenJobs(appSessionId: AppSessionId, driven: boolean): readonly Job[] | null {
  useEffect(() => (driven ? watchLaneA(appSessionId, () => {}) : undefined), [appSessionId, driven]);
  return useLaneAJobs(appSessionId);
}
