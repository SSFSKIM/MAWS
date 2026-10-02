// A saved-queue edit and a launch's recovery each own a whole read/modify/save transaction. The store serializes
// individual IO calls, not transactions; share this lane across IPC and MessageQueue for each host store/session.
import type { SessionStateStore } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';

const stores = new WeakMap<SessionStateStore, Map<AppSessionId, Promise<unknown>>>();

export function queueTransaction<T>(store: SessionStateStore, id: AppSessionId, operation: () => Promise<T>): Promise<T> {
  let chains = stores.get(store);
  if (!chains) {
    chains = new Map();
    stores.set(store, chains);
  }
  const lane = chains;
  const previous = lane.get(id) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  lane.set(id, next);
  void next.finally(() => { if (lane.get(id) === next) lane.delete(id); }).catch(() => {});
  return next;
}
