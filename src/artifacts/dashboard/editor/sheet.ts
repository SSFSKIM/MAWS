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

export interface SourceSheetSnapshot {
  open: boolean;
  datasets: readonly SheetDataset[];
  selected: string | null;
  /** A new serial for each opening, so the sheet takes the focus again when it is opened again. */
  opened: number;
  /** E3: whether the captured snapshots are held yet (`pending`), held, or could not be (`unavailable`: never shown). */
  hold: 'pending' | 'held' | 'unavailable';
}

const CLOSED: SourceSheetSnapshot = { open: false, datasets: [], selected: null, opened: 0, hold: 'held' };

export class SourceSheetState {
  private current = CLOSED;
  private readonly listeners = new Set<() => void>();
  private lease: SnapshotLease | null = null; // E3: the hold over the captured snapshots, until the sheet closes or reopens

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = (): SourceSheetSnapshot => this.current;

  /** Opens on `datasets` (copied), `selected` shown first (else the first, else none). E3: `hold`, the lease over the
   * snapshots they name, gates what the sheet shows until it is in place and is let go when the sheet closes or reopens. */
  open(datasets: readonly SheetDataset[], selected?: string, hold?: SnapshotLease): void {
    const copies = datasets.map(({ id, descriptor, view }) => ({ id, descriptor: structuredClone(descriptor), ...(view && { view: structuredClone(view) }) }));
    const shown = copies.find((dataset) => dataset.id === selected)?.id ?? copies[0]?.id ?? null;
    this.lease?.release();
    this.lease = hold ?? null;
    const opened = this.current.opened + 1;
    this.set({ open: true, datasets: copies, selected: shown, opened, hold: hold ? 'pending' : 'held' });
    hold?.ready.then(
      () => this.settled(opened, hold, 'held'),
      () => this.settled(opened, hold, 'unavailable'),
    );
  }
  select(id: string): void {
    if (this.current.datasets.some((dataset) => dataset.id === id)) this.set({ ...this.current, selected: id });
  }
  close(): void {
    this.lease?.release(); // E3
    this.lease = null;
    if (this.current.open) this.set({ ...CLOSED, opened: this.current.opened });
  }

  // E3: the opening's hold settled; a later opening or a close made it moot
  private settled(opened: number, hold: SnapshotLease, outcome: 'held' | 'unavailable'): void {
    if (this.lease !== hold || this.current.opened !== opened || !this.current.open) return;
    this.set({ ...this.current, hold: outcome });
  }

  private set(next: SourceSheetSnapshot): void {
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }
}
