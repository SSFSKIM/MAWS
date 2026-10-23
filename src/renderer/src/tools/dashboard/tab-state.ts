// The state a dashboard tab owns (P3-E2 M3; X32's lifetime rule, E's Decision Log 19): B's DocumentTabState, made with
// B's window dependencies (its replica, header state, history, comments and close guard, never a copy of them), and the
// dashboard's own beside it: the snapshot reader every view and the source sheet share, the charts' renderer, the
// source sheet's state, and the datasets of the document the editor shows (captured as values whenever it changes, so
// the header's Datasets action reads what is on screen, a version's in history included, without keeping a preview's
// document past its life). M4: its dataset changes join B's history through the tab's history hook. E3 M3: its live
// datasets (./live-datasets.ts), following the live document and shown while the body is, its window's document is and
// no history preview or suggestion review is (B's `previewing`, the header's read-only state).
import { actorDisplay, type Actor } from '@shared/artifacts/actor';
import { listDatasets, snapshotOf, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import { datasetChanges } from '@artifacts/dashboard/history';
import { createChartRenderer } from '@artifacts/dashboard/editor/chart-view';
import { SourceSheetState, type SheetDataset, type SheetRecapture } from '@artifacts/dashboard/editor/sheet';
import { SnapshotReader } from '@artifacts/dashboard/snapshots';
import { onUpdate, type Doc } from '@artifacts/yjs';
import type { ArtifactEditorTarget } from '../../artifacts/registry';
import { DocumentTabState, type DocumentTabDeps } from '../document/tab-state';
import { LiveDatasetsController } from './live-datasets'; // E3
import type { DashboardLiveDeps } from './live-start'; // E3
import { PreviewHold } from './preview-hold'; // E3 panel
import { datasetFileApi, type DatasetFileApi } from './file-source-api'; // WR 67

/** E3: how long an open source sheet whose hold the host's restart took waits for the displayed document to sync again
 * before it says the snapshot is unavailable (the host has not come back). */
export const RECAPTURE_SYNC_MS = 15_000;

// E3 M3: a tab made without the window's Start (a test's) refuses it in words rather than starting anything.
const NO_START: DashboardLiveDeps = { startSession: async () => ({ status: 'refused', appSessionId: null, words: 'Starting a session is not available here' }) };

export class DashboardTabState {
  readonly artifactId: string;
  readonly document: DocumentTabState;
  readonly sheet = new SourceSheetState();
  readonly reader: SnapshotReader;
  readonly renderChart: ReturnType<typeof createChartRenderer>;
  readonly live: LiveDatasetsController; // E3 M3
  readonly fileSources: DatasetFileApi; // WR 67
  private bodyShown = false; // E3 M3: the body on screen and its window's document visible
  private shown: SheetDataset[] = [];
  private shownDoc: Doc | null = null; // P3-F: the document `shown` is of
  private stopShown = () => {};
  private readonly preview: PreviewHold; // E3 panel: the snapshots a displayed preview names, held while it is displayed
  // E3: how many times the live replica has come to be live and synced (a host restart's reconnection is one more)
  private syncs = 0;
  private synced = false;
  private readonly syncWaiters = new Set<() => void>();
  private readonly stopSync: () => void;
  private disposed = false;

  constructor(
    target: ArtifactEditorTarget,
    private readonly deps: DocumentTabDeps,
    liveDeps: DashboardLiveDeps = NO_START, // E3 M3
  ) {
    this.artifactId = target.artifactId;
    this.fileSources = datasetFileApi(target.artifactId, deps.ipc);
    this.live = new LiveDatasetsController({
      artifactId: target.artifactId,
      host: deps.host,
      onGrantChanged: (listener) => deps.ipc.on('connectors.grantChanged', (change) => listener(change.artifactId)),
      startSession: (previous) => liveDeps.startSession(target.artifactId, previous),
      ...(liveDeps.openSession && { openSession: liveDeps.openSession as (appSessionId: string) => void }),
      log: deps.log,
    });
    this.document = new DocumentTabState(target, { ...deps, extraChanges: datasetChanges }); // M4: B's history counts its dataset changes
    this.reader = new SnapshotReader(deps.host, target.artifactId);
    this.preview = new PreviewHold((refs) => this.reader.holdAll(refs), (line) => deps.log(`dashboard ${target.artifactId}: ${line}`)); // E3 panel
    this.renderChart = createChartRenderer({
      reader: this.reader,
      actorName: this.actorName,
      openSource: ({ datasetId, descriptor, view }) => this.openSheet([{ id: datasetId, descriptor, ...(view && { view }) }], datasetId),
      live: this.live, // E3 M3
    });
    this.stopSync = this.document.subscribe(() => this.followSync());
    this.followSync();
  }

  // E3: counts each arrival of the live replica at live and synced. E3 M3: and follows the live document and the
  // preview for the live datasets.
  private followSync(): void {
    const { handle, previewing } = this.document.snapshot();
    if (handle && !this.disposed) this.live.follow(handle.doc);
    this.live.setShown(this.bodyShown && !previewing);
    this.sheet.setPreviewing(previewing); // E3 M3 fix: an open sheet's live controls go while a preview runs
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

  /** The editor shows `doc` now (the live one, a version's, the suggestion replica's): its datasets, followed as values.
   * E3 panel: a preview's (any document but the live one) snapshots held while it is displayed (./preview-hold.ts); the
   * live document takes no such hold, its current descriptors protecting what it names. */
  displayed = (doc: Doc): void => {
    this.stopShown();
    const preview = doc !== this.document.snapshot().handle?.doc; // E3 panel
    this.shownDoc = doc; // P3-F
    const capture = () => {
      this.shown = listDatasets(doc).map(({ id, descriptor }) => ({ id, descriptor }));
      this.preview.want(preview ? this.shown.flatMap(({ descriptor }) => snapshotOf(descriptor)?.ref ?? []) : []); // E3 panel
    };
    capture();
    this.stopShown = onUpdate(doc, capture);
  };

  /** E3 panel residual: the editor's body unmounted (its tab inactive or its surface gone, not its window merely hidden):
   * B's history dropped any preview or review with it, so the live document is what the tab shows again and the
   * preview's hold goes, never taken again by a later restart. */
  bodyUnmounted = (): void => {
    const live = this.document.snapshot().handle?.doc;
    if (live && !this.disposed) return this.displayed(live);
    this.stopShown();
    this.stopShown = () => {};
    this.preview.clear();
  };

  /** E3 M3: the editor's report that its body is on screen with its window's document visible (false once it unmounts). */
  setBodyShown = (shown: boolean): void => {
    this.bodyShown = shown;
    if (!this.disposed) this.live.setShown(shown && !this.document.snapshot().previewing);
  };

  /** E3 M3: the sheet opened again on the current capture of its datasets (each with the view it was opened from),
   * `selected` shown: the owner's explicit way to a newer fetch or a replaced query. P3-F: its datasets all removed
   * since, on the shown document's others (none only when none remain). */
  reopenSheet = (selected: string): void => {
    const views = new Map(this.sheet.snapshot().datasets.map(({ id, view }) => [id, view]));
    const ids = this.sheet.snapshot().open ? [...views.keys()] : [selected];
    const datasets = this.shown.filter(({ id }) => ids.includes(id)).map((dataset) => ({ ...dataset, ...(views.get(dataset.id) && { view: views.get(dataset.id) }) }));
    this.openSheet(datasets.length > 0 ? datasets : this.shown, selected);
  };

  /** The header's Datasets: the sheet on the shown document's datasets, or closed when it is open. */
  toggleDatasets = (): void => {
    if (this.sheet.snapshot().open) this.sheet.close();
    else this.openSheet(this.shown);
  };

  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b): the snapshots a sheet captured, held from its
  // opening (a painted view's cached hold duplicated at once) to its close; a hold the host's restart takes is answered by
  // one recapture of the latest, once the replica has synced again since the hold was taken. P3-F: the latest of the
  // document it opened on (the one displayed then), whatever the editor displays by the restart.
  private openSheet(datasets: readonly SheetDataset[], selected?: string): void {
    this.sheet.open(datasets, selected, this.holdShown(datasets.map(({ descriptor }) => descriptor)), this.recapture(this.syncs, this.shownDoc), this.document.snapshot().previewing /* E3 M3 */);
  }

  private holdShown(descriptors: readonly DatasetDescriptor[]) {
    return this.reader.holdAll(descriptors.flatMap((descriptor) => snapshotOf(descriptor)?.ref ?? []));
  }

  private recapture(since: number, on: Doc | null): SheetRecapture {
    return async (ids) => {
      if (!(await this.syncedSince(since)) || this.disposed) return null;
      const captured = this.sheet.snapshot().datasets;
      const views = new Map(captured.map(({ id, view }) => [id, view]));
      const latestOf = this.latestOn(on, captured);
      const datasets = ids.flatMap((id) => {
        const latest = latestOf.find((dataset) => dataset.id === id);
        const view = views.get(id);
        return latest ? [{ ...latest, ...(view && { view }) }] : [];
      });
      if (datasets.length === 0) return null;
      return { datasets, hold: this.holdShown(datasets.map(({ descriptor }) => descriptor)) };
    };
  }

  // P3-F: the latest datasets of the document `on` a sheet opened on: the live document's current ones, whatever the
  // editor displays now; a preview's while it is still displayed; else (that preview ended) the sheet's own capture of
  // it, a version's descriptors being immutable. The sheet keeps its own preview flag, so either is labelled as opened.
  private latestOn(on: Doc | null, captured: readonly SheetDataset[]): readonly SheetDataset[] {
    if (on === this.shownDoc) return this.shown;
    const live = this.document.snapshot().handle?.doc;
    if (on === null || on === live) return live ? listDatasets(live).map(({ id, descriptor }) => ({ id, descriptor })) : [];
    return captured;
  }

  // Whether the live replica synced again after the host's loss: synced now, at a later sync than `since` (the hold's),
  // else at its next sync within RECAPTURE_SYNC_MS. E3 panel (Decision Log 16 (4)): a replica not synced when the loss is
  // heard waits for the sync that follows it, compared across the loss, so a reconnect between the hold and the restart
  // never passes for it.
  private syncedSince(since: number): Promise<boolean> {
    if (this.synced && this.syncs > since) return Promise.resolve(true);
    const loss = this.syncs; // E3 panel: the generation when the loss was heard
    return new Promise((resolve) => {
      const done = (fresh: boolean) => {
        clearTimeout(timer);
        this.syncWaiters.delete(wake);
        resolve(fresh);
      };
      const wake = () => done(this.syncs > loss);
      const timer = setTimeout(() => done(false), RECAPTURE_SYNC_MS);
      this.syncWaiters.add(wake);
    });
  }

  dispose(): void {
    this.disposed = true; // E3
    this.stopSync();
    this.live.dispose(); // E3 M3: its surface closes, ending its watches and calls
    for (const wake of [...this.syncWaiters]) wake();
    this.stopShown();
    this.stopShown = () => {};
    this.preview.dispose(); // E3 panel
    this.sheet.close();
    this.reader.dispose(); // E3: the reader's holds go with the tab
    this.document.dispose();
  }
}
