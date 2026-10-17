// P3-E1 M4 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M4; the parent's Decision Log 23): the history api a
// design tab's history reads, B's api on A's IPC (../document/history-api.ts) with one change: a retained version from before the design model (an earlier
// build's generic files, Decision Log 11 (1)) answers its state as its migration would build it, on a temporary copy
// (`withDesignModel`), encoded before that copy is destroyed; the retained state itself is never written or migrated. A
// version in the model answers its own bytes, so the diff keeps its items' identities and provenance.
import type { HistoryApi } from '@artifacts/document/editor/history/api';
import { isLegacyDesign, withDesignModel } from '@artifacts/design/migrate';
import { applyV2, newDoc, stateV2 } from '@artifacts/yjs';

/** A version's state as the design's history draws it (module header). */
export function designVersionState(state: Uint8Array): Uint8Array {
  const doc = newDoc();
  try {
    applyV2(doc, state);
    return isLegacyDesign(doc) ? withDesignModel(doc, (model) => stateV2(model)) : state;
  } finally {
    doc.destroy();
  }
}

/** `api` with its version states read through the design model; one per tab, so the history controller keeps it. */
export function designHistoryApi(api: HistoryApi): HistoryApi {
  return { ...api, versionState: async (versionId) => designVersionState(await api.versionState(versionId)) };
}
