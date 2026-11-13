// U11a M9 (the execution document's Interfaces §G): what the Settings page shows now. Each drawn row tells the view
// its declaration's id and the state it shows; the view holds one `DrawnRows` for its page, and the search (M10) reads
// `shown`, each drawn row's id and state (a repeating row's first item's), so it never names text the page does not show.
import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react';

export class DrawnRows {
  private readonly items = new Map<object, { id: string; state: string }>();
  private snapshot: ReadonlyMap<string, string> = new Map();
  private readonly listeners = new Set<() => void>();

  set(item: object, id: string, state: string): void {
    this.items.set(item, { id, state });
    this.changed();
  }

  delete(item: object): void {
    if (this.items.delete(item)) this.changed();
  }

  readonly shown = (): ReadonlyMap<string, string> => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private changed(): void {
    const next = new Map<string, string>();
    for (const { id, state } of this.items.values()) if (!next.has(id)) next.set(id, state);
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export const DrawnRowsContext = createContext<DrawnRows | null>(null);

// A row drawn under its declaration's id, in `state`; null for a row the table does not hold (the Org page's).
export function useDrawnRow(id: string | null, state: string | null): void {
  const rows = useContext(DrawnRowsContext);
  const [item] = useState(() => ({}));
  useLayoutEffect(() => {
    if (rows !== null && id !== null && state !== null) rows.set(item, id, state);
    else rows?.delete(item);
  }, [rows, item, id, state]);
  useLayoutEffect(() => () => rows?.delete(item), [rows, item]);
}

const NOTHING: ReadonlyMap<string, string> = new Map();
const unsubscribed = () => () => {};

// Each drawn row's id and the state it shows, kept current as rows are drawn, change state and go.
export function useShownRows(): ReadonlyMap<string, string> {
  const rows = useContext(DrawnRowsContext);
  return useSyncExternalStore(rows?.subscribe ?? unsubscribed, rows?.shown ?? (() => NOTHING));
}
