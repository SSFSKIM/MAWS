// The engine host's dashboard module (P3-E2 M2; docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md): registers the
// `dashboard` kind's adapter with A's document service, B's document adapter under the dashboard kind (portable,
// src/artifacts/dashboard/adapter.ts) wrapped here with the derived change index its hooks keep in the store's metadata
// in the frame of each write (changes.ts). B's tools reach the adapter by the artifact's kind (`documentAdapterOf`),
// `artifact_dataset` reaches its `lastChange` through `dashboardAdapterOf`. M5: the mirror writer, registered beside it. Wired by one line in src/engine-host/index.ts.
import { dashboardAdapter } from '@artifacts/dashboard/adapter';
import { dashboardMirrorWriter } from '@artifacts/dashboard/mirror'; // E2 M5
import { registerMirrorWriter } from '@artifacts/library/mirror'; // E2 M5
import type { DocumentAdapter } from '@artifacts/document/adapter';
import { mainOf } from '../documents/service';
import type { Documents } from '../documents';
import type { ArtifactStore } from '../documents/store';
import { DatasetChanges } from './changes';

export interface DashboardAdapter extends DocumentAdapter {
  /** The revision at which this dashboard's `datasetId` descriptor last changed (conservatively the live one when unknown). */
  lastChange(artifactId: string, datasetId: string): number;
}

export interface Dashboards {
  close(): void;
}

export function registerDashboards({ documents }: { documents: Pick<Documents, 'store' | 'service'> | null }): Dashboards {
  if (!documents) return { close: () => {} };
  const { store, service } = documents;
  const base = dashboardAdapter();
  const changes = new DatasetChanges(store.storage, (artifactId) => service.revision(artifactId));
  // a suggestion doc (`<id>:suggest`) holds proposals, never the dashboard's datasets of record: no index of its own
  const noted = (artifactId: string, doc: Parameters<DatasetChanges['note']>[1]) => {
    if (mainOf(artifactId) === null) changes.note(artifactId, doc);
  };
  const adapter: DashboardAdapter = {
    ...base,
    afterUpdate(doc, info) {
      const outcome = base.afterUpdate!(doc, info);
      noted(info.artifactId, doc);
      if (mainOf(info.artifactId) === null) store.reconcileQuerySnapshots(info.artifactId, doc); // E3: the snapshots' retention follows the datasets
      return outcome;
    },
    afterRestore(doc, info) {
      const outcome = base.afterRestore!(doc, info);
      noted(info.artifactId, doc);
      if (mainOf(info.artifactId) === null) store.reconcileQuerySnapshots(info.artifactId, doc, { restored: true }); // E3: each query reset to the snapshot it names
      return outcome;
    },
    lastChange: (artifactId, datasetId) => changes.lastChange(artifactId, datasetId),
  };
  store.registerAdapter(adapter);
  const off = store.onChange((change) => {
    if (change.kind === 'dashboard' && change.change === 'deleted') adapter.forgetArtifact(change.artifactId);
  });
  // E2 M5: a linked Space mirrors the dashboard's dialect, its bindings and its snapshots (src/artifacts/dashboard/mirror.ts)
  const offMirror = registerMirrorWriter('dashboard', dashboardMirrorWriter);
  return {
    close: () => {
      off();
      offMirror();
    },
  };
}

/** The dashboard adapter registered with `store`, or null when the dashboard kind is not registered. */
export function dashboardAdapterOf(store: ArtifactStore): DashboardAdapter | null {
  const adapter = store.service.adapterFor('dashboard') as Partial<DashboardAdapter> | undefined;
  return adapter && typeof adapter.lastChange === 'function' ? (adapter as DashboardAdapter) : null;
}
