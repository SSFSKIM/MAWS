// WR 49: visible-open counts follow thread writes at once and target edits after a quiet moment. A document's
// targets require walking its marks, so neither snapshots nor sustained typing repeat that walk on every render.
import { onUpdate, type Doc } from '../yjs';

type Counts = { total: number; targets: ReadonlyMap<string, number> };

export function commentCountStore(doc: Doc, read: () => ReadonlyMap<string, number>, observeThreads: (doc: Doc, listener: () => void) => () => void) {
  const snapshot = (): Counts => {
    const targets = read();
    return { targets, total: [...targets.values()].reduce((sum, count) => sum + count, 0) };
  };
  let current = snapshot();
  const listeners = new Set<() => void>();
  let stop: (() => void) | null = null;
  const update = () => {
    const next = snapshot();
    if (next.targets.size === current.targets.size && [...next.targets].every(([id, count]) => current.targets.get(id) === count)) return;
    current = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (stop === null) {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const offThreads = observeThreads(doc, update);
        const offDoc = onUpdate(doc, () => {
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            update();
          }, 50);
        });
        stop = () => {
          offThreads();
          offDoc();
          if (timer !== null) clearTimeout(timer);
        };
        update(); // a change while no one listened is read again
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stop?.();
          stop = null;
        }
      };
    },
  };
}
