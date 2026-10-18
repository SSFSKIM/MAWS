// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): route E's dataset sink, the host's half. A
// connector start that carries `dataset` is admitted here before anything is asked of the engine: an agent's (its
// `requestId`) must be the pending request it names (./dataset-requests.ts), which makes its session the actor and its
// registry the owner of the publication's end; a page's is the human's. The dashboard's refresh transaction
// (../dashboards/refresh.ts) then checks the call against the dataset's query and captures its identity, and publishes
// the result once main takes it.
import type { Actor } from '@shared/artifacts/actor';
import { datasetRefresher, type RefreshPublish, type RefreshScope, type RefreshStart } from '../dashboards/refresh';
import type { ArtifactStore } from '../documents/store';
import type { DatasetRefreshRequests, DatasetRefreshScope, DatasetRefreshStart } from './dataset-requests';

export type ConnectorDatasetStart = DatasetRefreshStart & RefreshStart;

export interface ConnectorDatasetSink {
  // The start admitted, its publication to run once main takes the result; or why not (`stale`: the dataset changed
  // or went since it was asked for), nothing asked of the engine. `cancel` withdraws the operation (an agent's request
  // that ended otherwise than by its publication).
  admit(start: ConnectorDatasetStart, cancel: () => void): Promise<{ publish: RefreshPublish } | { refusal: string; stale?: true }>;
}

const HUMAN: Actor = { kind: 'human' };

export function connectorDatasetSink(deps: { store: () => ArtifactStore | null; requests: DatasetRefreshRequests | null; now?: () => number; log?: (line: string) => void }): ConnectorDatasetSink {
  return {
    async admit(start, cancel) {
      const store = deps.store();
      if (!store) return { refusal: 'the artifact store is unavailable this run' };
      const { requestId } = start.dataset;
      let scope: RefreshScope & Partial<Pick<DatasetRefreshScope, 'refused'>>;
      if (requestId === undefined) {
        scope = { actor: HUMAN, opId: null, admit: () => true };
      } else {
        const claimed = deps.requests?.claim(requestId, start, cancel) ?? null;
        if (!claimed) return { refusal: `no pending dataset refresh request ${requestId} is this call` };
        scope = claimed;
      }
      const admission = await datasetRefresher(store, { now: deps.now, log: deps.log }).admit(start, scope);
      if (!admission.ok) {
        scope.refused?.(admission.refusal, admission.stale === true);
        return { refusal: admission.refusal, ...(admission.stale && { stale: true as const }) };
      }
      return admission; // its publication tells the scope how it ended
    },
  };
}
