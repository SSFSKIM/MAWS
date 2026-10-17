// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): route E's dataset sink, the host's half. A
// connector start that carries `dataset` is admitted here before anything is asked of the engine: an agent's (its
// `requestId`) must be the pending request it names (./dataset-requests.ts), which makes its session the actor; a
// page's is the human's. The dashboard's refresh transaction (../dashboards/refresh.ts) then checks the call against
// the dataset's query and captures its identity, and publishes the result once main takes it.
import type { Actor } from '@shared/artifacts/actor';
import { datasetRefresher, type RefreshGuard, type RefreshPublication, type RefreshRaw, type RefreshScope, type RefreshStart } from '../dashboards/refresh';
import type { ArtifactStore } from '../documents/store';
import type { DatasetRefreshRequests, DatasetRefreshStart } from './dataset-requests';

export type ConnectorDatasetStart = DatasetRefreshStart & RefreshStart;

export interface ConnectorDatasetSink {
  // The start admitted, its publication to run once main takes the result; or why not, nothing asked of the engine.
  // `cancel` withdraws the operation (an agent's request that ended otherwise than by main's reply).
  admit(start: ConnectorDatasetStart, cancel: () => void): Promise<{ publish(raw: RefreshRaw, guard: RefreshGuard): Promise<RefreshPublication> } | { refusal: string }>;
}

const HUMAN: Actor = { kind: 'human' };

export function connectorDatasetSink(deps: { store: () => ArtifactStore | null; requests: DatasetRefreshRequests | null; now?: () => number }): ConnectorDatasetSink {
  return {
    async admit(start, cancel) {
      const store = deps.store();
      if (!store) return { refusal: 'the artifact store is unavailable this run' };
      const { requestId } = start.dataset;
      let scope: RefreshScope & { refused?(refusal: string): void };
      if (requestId === undefined) {
        scope = { actor: HUMAN, opId: null, live: () => true };
      } else {
        const claimed = deps.requests?.claim(requestId, start, cancel) ?? null;
        if (!claimed) return { refusal: `no pending dataset refresh request ${requestId} is this call` };
        scope = claimed;
      }
      const admission = await datasetRefresher(store, { now: deps.now }).admit(start, scope);
      if (!admission.ok) {
        scope.refused?.(admission.refusal);
        return { refusal: admission.refusal };
      }
      // a publication discarded (the dataset changed, the grant or the request ended) is refused in the host's words
      return {
        publish: async (raw, guard) => {
          const publication = await admission.publish(raw, guard);
          if ('discarded' in publication) scope.refused?.(publication.detail);
          return publication;
        },
      };
    },
  };
}
