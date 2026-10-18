// The source sheet's state (P3-E2 M3; parent §2 "Views"): which datasets it shows and which one is selected, owned by
// the dashboard's tab (X32's lifetime rule: the header's Datasets action and a view's source label open it, whatever
// body is mounted) and drawn by the sheet beside the editor. Each dataset is the descriptor as it was captured when the
// sheet opened (a value, never the displayed document itself, which a preview destroys): a replacement while it is open
// leaves it on the snapshot it names until it is opened again. E3: the sheet holds the snapshots it captured from its
// opening to its close (a lease of the tab's reader), so their bytes outlast a refresh retiring them meanwhile.
import type { DatasetDescriptor } from '../datasets';
import type { SnapshotLease } from '../snapshots';

export interface SheetDataset {
  id: string;
  descriptor: DatasetDescriptor;
  /** The view it was opened from (a source label's), whose transformed rows the sheet shows beside the snapshot's. */
  view?: { spec: unknown; caption: string };
}

/** E3: a fresh capture of the latest for the datasets `ids` names (the opener's, once the displayed document has synced
 * again after the host's restart), or null when none can be had. */
export type SheetRecapture = (ids: string[]) => Promise<{ datasets: readonly SheetDataset[]; hold: SnapshotLease } | null>;

export interface SourceSheetSnapshot {
  open: boolean;
  datasets: readonly SheetDataset[];
  selected: string | null;
  /** A new serial for each opening, so the sheet takes the focus again when it is opened again. */
  opened: number;
  /** E3: whether the captured snapshots are held yet (`pending`), held, or could not be (`unavailable`: never shown). */
  hold: 'pending' | 'held' | 'unavailable';
  /** E3: a new serial for each capture the opening shows (its first, then a recapture after the host's restart). */
  capture: number;
  /** E3 M3: opened over a history preview: what it shows is a retained version's, with no live controls. */
  preview: boolean;
  /** E3 M3 fix: a history preview or suggestion review runs now (the editor is read-only): no live controls meanwhile. */
  previewing: boolean;
}

const CLOSED: SourceSheetSnapshot = { open: false, datasets: [], selected: null, opened: 0, hold: 'held', capture: 0, preview: false, previewing: false };

const copiesOf = (datasets: readonly SheetDataset[]): SheetDataset[] => datasets.map(({ id, descriptor, view }) => ({ id, descriptor: structuredClone(descriptor), ...(view && { view: structuredClone(view) }) }));

export class SourceSheetState {
  private current = CLOSED;
  private readonly listeners = new Set<() => void>();
  private lease: SnapshotLease | null = null; // E3: the hold over the captured snapshots, until the sheet closes or reopens
  private previewingNow = false; // E3 M3 fix

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = (): SourceSheetSnapshot => this.current;

  /** Opens on `datasets` (copied), `selected` shown first (else the first, else none). E3: `hold`, the lease over the
   * snapshots they name, gates what the sheet shows until it is in place and is let go when the sheet closes or reopens;
   * a hold lost while open (the host restarted) is answered by one `recapture` of the latest, else by `unavailable`.
   * E3 M3: `preview`, the datasets are a history preview's (no live controls). */
  open(datasets: readonly SheetDataset[], selected?: string, hold?: SnapshotLease, recapture?: SheetRecapture, preview = false): void {
    const copies = copiesOf(datasets);
    const shown = copies.find((dataset) => dataset.id === selected)?.id ?? copies[0]?.id ?? null;
    const opened = this.current.opened + 1;
    this.take(hold ?? null, { open: true, datasets: copies, selected: shown, opened, hold: hold ? 'pending' : 'held', capture: 0, preview, previewing: this.previewingNow }, recapture);
  }
  select(id: string): void {
    if (this.current.datasets.some((dataset) => dataset.id === id)) this.set({ ...this.current, selected: id });
  }
  close(): void {
    this.lease?.release(); // E3
    this.lease = null;
    if (this.current.open) this.set({ ...CLOSED, opened: this.current.opened, previewing: this.previewingNow });
  }

  /** E3 M3 fix: whether a history preview or suggestion review runs now; the open sheet keeps its capture and hold. */
  setPreviewing(previewing: boolean): void {
    this.previewingNow = previewing;
    if (this.current.previewing !== previewing) this.set({ ...this.current, previewing });
  }

  // E3: shows `next` on `hold`, letting the earlier lease go, and follows the new one's settling and loss
  private take(hold: SnapshotLease | null, next: SourceSheetSnapshot, recapture: SheetRecapture | undefined): void {
    this.lease?.release();
    this.lease = hold;
    this.set(next);
    if (!hold) return;
    const mine = () => this.lease === hold && this.current.open && this.current.opened === next.opened;
    let lost = false; // a loss is terminal for this capture: its late ready or failure revives nothing
    hold.ready.then(
      () => mine() && !lost && this.set({ ...this.current, hold: 'held' }),
      () => mine() && !lost && this.set({ ...this.current, hold: 'unavailable' }),
    );
    void hold.invalidated.then(async () => {
      if (!mine()) return;
      lost = true;
      this.set({ ...this.current, hold: 'pending' }); // nothing of the lost capture is shown or read meanwhile
      if (!recapture) {
        hold.release();
        return this.set({ ...this.current, hold: 'unavailable' }); // the one recapture is spent, or none is offered
      }
      const fresh = await recapture(this.current.datasets.map((dataset) => dataset.id)).catch(() => null);
      if (this.lease !== hold || !this.current.open || this.current.opened !== next.opened) return fresh?.hold.release();
      if (!fresh) {
        hold.release();
        return this.set({ ...this.current, hold: 'unavailable' });
      }
      const copies = copiesOf(fresh.datasets);
      const selected = copies.find((dataset) => dataset.id === this.current.selected)?.id ?? copies[0]?.id ?? null;
      this.take(fresh.hold, { ...this.current, datasets: copies, selected, hold: 'pending', capture: this.current.capture + 1 }, undefined);
    });
  }

  private set(next: SourceSheetSnapshot): void {
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }
}
