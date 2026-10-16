// The state a dashboard tab owns (P3-E2 M3; X32's lifetime rule, E's Decision Log 19): B's DocumentTabState, made with
// B's window dependencies (its replica, header state, history, comments and close guard, never a copy of them), and the
// dashboard's own beside it: the snapshot reader every view and the source sheet share, the charts' renderer, the
// source sheet's state, and the datasets of the document the editor shows (captured as values whenever it changes, so
// the header's Datasets action reads what is on screen, a version's in history included, without keeping a preview's
// document past its life).
import { actorDisplay, type Actor } from '@shared/artifacts/actor';
import { listDatasets } from '@artifacts/dashboard/datasets';
import { createChartRenderer } from '@artifacts/dashboard/editor/chart-view';
import { SourceSheetState, type SheetDataset } from '@artifacts/dashboard/editor/sheet';
import { SnapshotReader } from '@artifacts/dashboard/editor/snapshots';
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
    this.document = new DocumentTabState(target, deps);
    this.reader = new SnapshotReader(deps.host, target.artifactId);
    this.renderChart = createChartRenderer({
      reader: this.reader,
      actorName: this.actorName,
      openSource: ({ datasetId, descriptor }) => this.sheet.open([{ id: datasetId, descriptor }], datasetId),
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
    else this.sheet.open(this.shown);
  };

  dispose(): void {
    this.stopShown();
    this.stopShown = () => {};
    this.sheet.close();
    this.document.dispose();
  }
}
