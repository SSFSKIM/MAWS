// UX wave U3, first landing (the U3a document, M5): the engine mounts one UserMessage site per carrier, so of a carrier's
// notices one asks and the others follow it. They follow the drawing its SurfaceRow applied (its `onInk` report of
// whether MAWS's own drawing shows), not the raw answer: a rewrite refused or a drawing that failed brings MAWS's line
// back for the asking notice, and then for every notice of the carrier. A carrier is keyed by its session and the
// site's instance id; one not reported, or whose asking notice is gone, conceals nothing.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';

const carrierKey = (appSessionId: AppSessionId, instanceId: string) => `${appSessionId}\u0000${instanceId}`;
const useConcealed = create<ReadonlySet<string>>(() => new Set());

/** The asking notice's report: whether its applied drawing conceals MAWS's own (a mod replaced or hid the carrier). */
export function setCarrierConcealed(appSessionId: AppSessionId, instanceId: string, concealed: boolean): void {
  const key = carrierKey(appSessionId, instanceId);
  if (useConcealed.getState().has(key) === concealed) return;
  useConcealed.setState((s) => {
    const next = new Set(s);
    if (concealed) next.add(key); else next.delete(key);
    return next;
  }, true);
}

export function useCarrierConcealed(appSessionId: AppSessionId | null, instanceId: string): boolean {
  return useConcealed((s) => appSessionId !== null && s.has(carrierKey(appSessionId, instanceId)));
}
