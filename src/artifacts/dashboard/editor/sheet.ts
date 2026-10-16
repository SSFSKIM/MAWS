// The source sheet's state (P3-E2 M3; parent §2 "Views"): which datasets it shows and which one is selected, owned by
// the dashboard's tab (X32's lifetime rule: the header's Datasets action and a view's source label open it, whatever
// body is mounted) and drawn by the sheet beside the editor. Each dataset is the descriptor as it was captured when the
// sheet opened (a value, never the displayed document itself, which a preview destroys): a replacement while it is open
// leaves it on the snapshot it names until it is opened again.
import type { DatasetDescriptor } from '../datasets';

export interface SheetDataset {
  id: string;
  descriptor: DatasetDescriptor;
}

export interface SourceSheetSnapshot {
  open: boolean;
  datasets: readonly SheetDataset[];
  selected: string | null;
  /** A new serial for each opening, so the sheet takes the focus again when it is opened again. */
  opened: number;
}

const CLOSED: SourceSheetSnapshot = { open: false, datasets: [], selected: null, opened: 0 };

export class SourceSheetState {
  private current = CLOSED;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = (): SourceSheetSnapshot => this.current;

  /** Opens on `datasets` (copied), `selected` shown first (else the first, else none). */
  open(datasets: readonly SheetDataset[], selected?: string): void {
    const copies = datasets.map(({ id, descriptor }) => ({ id, descriptor: structuredClone(descriptor) }));
    const shown = copies.find((dataset) => dataset.id === selected)?.id ?? copies[0]?.id ?? null;
    this.set({ open: true, datasets: copies, selected: shown, opened: this.current.opened + 1 });
  }
  select(id: string): void {
    if (this.current.datasets.some((dataset) => dataset.id === id)) this.set({ ...this.current, selected: id });
  }
  close(): void {
    if (this.current.open) this.set({ ...CLOSED, opened: this.current.opened });
  }

  private set(next: SourceSheetSnapshot): void {
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }
}
