// The binding module: version states as stored (the P3-A document's Decision Log 8; parent Decision Log 36, P3-0's S7a
// `spikes/p3-store/s7/soak/store.mjs`). A version row holds either a full V2 state (a keyframe) or a V2 delta from the
// previous retained version's state; a retained version's state is its keyframe merged with the deltas after it. The
// host compresses the bytes (zstd); this module only computes them.
import * as Y from '@y/y';

const arr = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

// The delta from `previous` (a V2 state) to `state` (a later V2 state of the same doc): the structs `state` has beyond
// `previous`'s state vector, and only the deletions made since. (`diffUpdateV2` alone would repeat the whole delete set
// in every delta, S7a's pitfall 5.)
export function versionDelta(previous: Uint8Array, state: Uint8Array): Uint8Array {
  const since = Y.diffUpdateV2(arr(state), Y.encodeStateVectorFromUpdateV2(arr(previous)));
  const ids = Y.createContentIdsFromUpdateV2(since);
  const deletes = Y.diffIdSet(ids.deletes, Y.createContentIdsFromUpdateV2(arr(previous)).deletes);
  return Y.intersectUpdateWithContentIdsV2(since, Y.createContentIds(ids.inserts, deletes));
}

// Several V2 updates as one (a keyframe and the deltas after it; a dropped version folded into its successor).
export const mergeV2 = (updates: Uint8Array[]): Uint8Array => Y.mergeUpdatesV2(updates.map(arr));

// A V2 update re-encoded as the state of a doc it loads into: one canonical form, so two encodings of the same state
// compare equal byte for byte (a keyframe promoted from a merge is stored in this form).
export function canonicalV2(update: Uint8Array): Uint8Array {
  const doc = new Y.Doc({ gc: true });
  try {
    Y.applyUpdateV2(doc, update);
    return Y.encodeStateAsUpdateV2(doc);
  } finally {
    doc.destroy();
  }
}
