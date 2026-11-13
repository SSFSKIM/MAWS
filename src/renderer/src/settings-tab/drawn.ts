// U11a M9 (the execution document's Interfaces §G): what the Settings page shows now. Each drawn row tells the view
// its declaration's id and the state it shows; the view holds one `DrawnRows` for its page, and the search (M10) reads
// `shown`, each drawn row's id and state (a repeating row's first item's), so it never names text the page does not show.
// M10: the Org page's groups tell it the same way (`groups`, the ids of those drawn), so the search lists only those.
import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react';

export class DrawnRows {
  private readonly items = new Map<object, { id: string; state: string }>();
  private snapshot: ReadonlyMap<string, string> = new Map();
  private readonly groupItems = new Map<object, string>();
  private groupSnapshot: ReadonlySet<string> = new Set();
  private readonly listeners = new Set<() => void>();

  set(item: object, id: string, state: string): void {
    this.items.set(item, { id, state });
    this.changed();
  }

  delete(item: object): void {
    if (this.items.delete(item)) this.changed();
  }

  setGroup(item: object, id: string): void {
    this.groupItems.set(item, id);
    this.groupsChanged();
  }

  deleteGroup(item: object): void {
    if (this.groupItems.delete(item)) this.groupsChanged();
  }

  readonly shown = (): ReadonlyMap<string, string> => this.snapshot;
  readonly groups = (): ReadonlySet<string> => this.groupSnapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private changed(): void {
    const next = new Map<string, string>();
    for (const { id, state } of this.items.values()) if (!next.has(id)) next.set(id, state);
    this.snapshot = next;
    this.notify();
  }

  private groupsChanged(): void {
    this.groupSnapshot = new Set(this.groupItems.values());
    this.notify();
  }

  private notify(): void {
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

// M10: a group of the Org page drawn under its id ('you', 'people', 'machines', 'org').
export function useDrawnGroup(id: string): void {
  const rows = useContext(DrawnRowsContext);
  const [item] = useState(() => ({}));
  useLayoutEffect(() => {
    rows?.setGroup(item, id);
    return () => rows?.deleteGroup(item);
  }, [rows, item, id]);
}

const NOTHING: ReadonlyMap<string, string> = new Map();
const NO_GROUPS: ReadonlySet<string> = new Set();
const unsubscribed = () => () => {};

// Each drawn row's id and the state it shows, kept current as rows are drawn, change state and go.
export function useShownRows(): ReadonlyMap<string, string> {
  const rows = useContext(DrawnRowsContext);
  return useSyncExternalStore(rows?.subscribe ?? unsubscribed, rows?.shown ?? (() => NOTHING));
}

// M10: the ids of the Org page's groups drawn now.
export function useShownGroups(): ReadonlySet<string> {
  const rows = useContext(DrawnRowsContext);
  return useSyncExternalStore(rows?.subscribe ?? unsubscribed, rows?.groups ?? (() => NO_GROUPS));
}
