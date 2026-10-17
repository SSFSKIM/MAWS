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
import { SourceSheetState, type SheetDataset } from '@artifacts/dashboard/editor/sheet';
import { SnapshotReader } from '@artifacts/dashboard/snapshots';
import { onUpdate, type Doc } from '@artifacts/yjs';
import type { ArtifactEditorTarget } from '../../artifacts/registry';
import { DocumentTabState, type DocumentTabDeps } from '../document/tab-state';

export class DashboardTabState {
  readonly artifactId: string;
  readonly document: DocumentTabState;
  readonly sheet = new SourceSheetState();
  readonly reader: SnapshotReader;
  readonly renderChart: ReturnType<typeof createChartRenderer>;
  private shown: SheetDataset[] = [];
  private stopShown = () => {};

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
      openSource: ({ datasetId, descriptor, view }) => this.sheet.open([{ id: datasetId, descriptor, ...(view && { view }) }], datasetId, this.holdShown([descriptor])),
    });
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
    else this.sheet.open(this.shown, undefined, this.holdShown(this.shown.map(({ descriptor }) => descriptor)));
  };

  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R1b): the snapshots a sheet captured, held from its
  // opening (a painted view's cached hold duplicated at once) to its close
  private holdShown(descriptors: readonly DatasetDescriptor[]) {
    return this.reader.holdAll(descriptors.flatMap((descriptor) => snapshotOf(descriptor)?.ref ?? []));
  }

  dispose(): void {
    this.stopShown();
    this.stopShown = () => {};
    this.sheet.close();
    this.reader.dispose(); // E3: the reader's holds go with the tab
    this.document.dispose();
  }
}
