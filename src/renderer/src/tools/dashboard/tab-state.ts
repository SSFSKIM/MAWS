// The state a dashboard tab owns (P3-E2 M3; X32's lifetime rule, E's Decision Log 19): B's DocumentTabState, made with
// B's window dependencies (its replica, header state, history, comments and close guard, never a copy of them), and the
// dashboard's own beside it: the snapshot reader every view and the source sheet share, the charts' renderer, the
// source sheet's state, and the datasets of the document the editor shows (captured as values whenever it changes, so
// the header's Datasets action reads what is on screen, a version's in history included, without keeping a preview's
// document past its life). M4: its dataset changes join B's history through the tab's history hook.
import { actorDisplay, type Actor } from '@shared/artifacts/actor';
import { listDatasets, snapshotOf, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { datasetChanges } from '@artifacts/dashboard/history';
import { createChartRenderer } from '@artifacts/dashboard/editor/chart-view';
import { SourceSheetState, type SheetDataset, type SheetRecapture } from '@artifacts/dashboard/editor/sheet';
import { SnapshotReader } from '@artifacts/dashboard/snapshots';
import { onUpdate, type Doc } from '@artifacts/yjs';
import type { ArtifactEditorTarget } from '../../artifacts/registry';
import { DocumentTabState, type DocumentTabDeps } from '../document/tab-state';

/** E3: how long an open source sheet whose hold the host's restart took waits for the displayed document to sync again
 * before it says the snapshot is unavailable (the host has not come back). */
export const RECAPTURE_SYNC_MS = 15_000;

export class DashboardTabState {
  readonly artifactId: string;
  readonly document: DocumentTabState;
  readonly sheet = new SourceSheetState();
  readonly reader: SnapshotReader;
  readonly renderChart: ReturnType<typeof createChartRenderer>;
  private shown: SheetDataset[] = [];
  private stopShown = () => {};
  // E3: how many times the live replica has come to be live and synced (a host restart's reconnection is one more)
  private syncs = 0;
  private synced = false;
  private readonly syncWaiters = new Set<() => void>();
  private readonly stopSync: () => void;
  private disposed = false;

  constructor(
    target: ArtifactEditorTarget,
    private readonly deps: DocumentTabDeps,
  ) {
    this.artifactId = target.artifactId;
    this.document = new DocumentTabState(target, { ...deps, extraChanges: datasetChanges }); // M4: B's history counts its dataset changes
    this.reader = new SnapshotReader(deps.host, target.artifactId);
    this.renderChart = createChartRenderer({
      reader: this.reader,
      actorName: this.actorName,
      openSource: ({ datasetId, descriptor, view }) => this.openSheet([{ id: datasetId, descriptor, ...(view && { view }) }], datasetId),
    });
    this.stopSync = this.document.subscribe(() => this.followSync());
    this.followSync();
  }

  // E3: counts each arrival of the live replica at live and synced
  private followSync(): void {
    const state = this.document.snapshot().document;
    const now = state?.phase === 'live' && state.synced;
    if (now && !this.synced) {
      this.syncs += 1;
      for (const wake of [...this.syncWaiters]) wake();
    }
    this.synced = now;
  }

  /** Who an update is credited to: "You", a session by its title, else "Claude". */
  actorName = (actor: Actor): string => actorDisplay(actor, actor.kind === 'session' ? this.deps.sessionTitle(actor.appSessionId) : undefined).name;

  /** The editor shows `doc` now (the live one, a version's, the suggestion replica's): its datasets, followed as values. */
  displayed = (doc: Doc): void => {
    this.stopShown();
    const capture = () => {
      this.shown = listDatasets(doc).map(({ id, descriptor }) => ({ id, descriptor }));
    };
    capture();
    this.stopShown = onUpdate(doc, capture);
  };

  /** The header's Datasets: the sheet on the shown document's datasets, or closed when it is open. */
  toggleDatasets = (): void => {
    if (this.sheet.snapshot().open) this.sheet.close();
    else this.openSheet(this.shown);
  };

  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b): the snapshots a sheet captured, held from its
  // opening (a painted view's cached hold duplicated at once) to its close; a hold the host's restart takes is answered by
  // one recapture of the latest, once the replica has synced again since the hold was taken
  private openSheet(datasets: readonly SheetDataset[], selected?: string): void {
    this.sheet.open(datasets, selected, this.holdShown(datasets.map(({ descriptor }) => descriptor)), this.recapture(this.syncs));
  }

  private holdShown(descriptors: readonly DatasetDescriptor[]) {
    return this.reader.holdAll(descriptors.flatMap((descriptor) => snapshotOf(descriptor)?.ref ?? []));
  }

  private recapture(since: number): SheetRecapture {
    return async (ids) => {
      if (!(await this.syncedSince(since)) || this.disposed) return null;
      const views = new Map(this.sheet.snapshot().datasets.map(({ id, view }) => [id, view]));
      const datasets = ids.flatMap((id) => {
        const latest = this.shown.find((dataset) => dataset.id === id);
        const view = views.get(id);
        return latest ? [{ ...latest, ...(view && { view }) }] : [];
      });
      if (datasets.length === 0) return null;
      return { datasets, hold: this.holdShown(datasets.map(({ descriptor }) => descriptor)) };
    };
  }

  // Whether the live replica synced again after `since` (now or within RECAPTURE_SYNC_MS).
  private syncedSince(since: number): Promise<boolean> {
    if (this.syncs > since) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (fresh: boolean) => {
        clearTimeout(timer);
        this.syncWaiters.delete(wake);
        resolve(fresh);
      };
      const wake = () => done(this.syncs > since);
      const timer = setTimeout(() => done(false), RECAPTURE_SYNC_MS);
      this.syncWaiters.add(wake);
    });
  }

  dispose(): void {
    this.disposed = true; // E3
    this.stopSync();
    for (const wake of [...this.syncWaiters]) wake();
    this.stopShown();
    this.stopShown = () => {};
    this.sheet.close();
    this.reader.dispose(); // E3: the reader's holds go with the tab
    this.document.dispose();
  }
}
