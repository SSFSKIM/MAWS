// The binding module: artifact-wide restore as one update (parent §4.2 and Decision Log 29 and 36; the P3-A document's
// Decision Log 16). Kind-agnostic: a scratch gc-off doc holds the version's state and then the live state, the changes
// made since the version are undone there, and what the undo wrote is the update the host ships to the live doc, so
// concurrent edits merge by the CRDT rule and the update credits whoever restores. Copied from P3-0's S7a
// (`spikes/p3-store/s7/soak/revert.mjs` `revertUpdateFixed`), which fixed S3's `revertUpdate` in two ways:
//
// 1. v14's `Y.undoContentIds` builds its stack item as (inserts − deletes, deletes − inserts), so an item inserted AND
//    deleted since the version (the intermediate value of a map attribute overwritten twice or more) is in neither set;
//    redoing the version's value then meets that item on the key's overwrite chain, reads it as a concurrent change and
//    gives up (`UndoManager.js` `redoItem`), and the key ends up deleted. The stack item is therefore pushed directly:
//    its inserts keep every item inserted since (ones already deleted are skipped by the undo itself), and only the
//    redo set excludes them. Filed upstream as https://github.com/yjs/yjs/issues/814; when a `@y/y` release fixes
//    `undoContentIds`, the re-pin may return to it and keeps this module's overwrite-twice tests.
// 2. When nothing changed, the answer is a decodable empty update, not S3's 13 zero bytes.
import * as Y from '@y/y';

const idsOf = (doc: Y.Doc) => Y.createContentIdsFromDoc(doc, true);
const EMPTY = Y.encodeStateAsUpdateV2(new Y.Doc());

// The V2 update that takes a doc at `liveState` back to the content of `oldState` (both V2 states of the same doc,
// `oldState` an ancestor). `keep` names changes made since the version that the restore leaves in place (a kind's
// `revertScope`, e.g. the messages posted to a thread); everything else since is undone.
export function revertUpdate(oldState: Uint8Array, liveState: Uint8Array, keep?: Y.ContentIds | null): Uint8Array {
  const scratch = new Y.Doc({ gc: false });
  try {
    Y.applyUpdateV2(scratch, oldState);
    const oldIds = idsOf(scratch);
    Y.applyUpdateV2(scratch, liveState);
    let since = Y.excludeContentIds(idsOf(scratch), oldIds);
    if (keep) since = Y.excludeContentIds(since, keep);
    let update: Uint8Array | null = null;
    scratch.on('updateV2', (u: Uint8Array) => {
      update = update ? Y.mergeUpdatesV2([update as Uint8Array<ArrayBuffer>, u as Uint8Array<ArrayBuffer>]) : u;
    });
    const undo = new Y.UndoManager(scratch);
    undo.undoStack.push({ inserts: since.inserts, deletes: Y.diffIdSet(since.deletes, since.inserts), meta: new Map() });
    undo.undo();
    undo.destroy();
    return update ?? EMPTY;
  } finally {
    scratch.destroy();
  }
}
