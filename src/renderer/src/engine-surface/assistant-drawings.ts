import { create } from 'zustand';

// Mounted drawings own presentation ahead of folded probes. Surface teardown also leaves their promotion
// in place until the mounted row can report its detached drawing (or demote itself to native commentary).
export const useAssistantDrawings = create<ReadonlyMap<string, number>>(() => new Map());
export const assistantDrawingKey = (storeKey: string, rowId: string) => `${storeKey}\u0000${rowId}`;

export function retainAssistantDrawing(key: string) {
  useAssistantDrawings.setState((s) => new Map(s).set(key, (s.get(key) ?? 0) + 1), true);
  return () => useAssistantDrawings.setState((s) => {
    const next = new Map(s), count = next.get(key)! - 1;
    if (count) next.set(key, count);
    else next.delete(key);
    return next;
  }, true);
}
