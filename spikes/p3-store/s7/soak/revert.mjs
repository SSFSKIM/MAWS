// S7a (P3-0): S3's restore (s3/lib/restore.mjs `revertUpdate`) with two fixes found by the soak.
// 1. `Y.undoContentIds` builds its stack item as (inserts − deletes, deletes − inserts), so an item inserted AND deleted
//    since the version (an intermediate value of a map attribute overwritten twice or more) is in neither set; redoing
//    the version's value then walks the key's overwrite chain, meets that intermediate item, does not find it among the
//    items being deleted, reads it as a concurrent remote change and gives up (UndoManager.js `redoItem`, the parentSub
//    branch): the key ends up deleted. Every map attribute changed twice since the version (a drag's style:left, a task
//    toggled twice, a slide's order re-keyed twice) is lost. Fix: the stack item's inserts keep every item inserted since
//    (already-deleted ones are skipped by the undo's `!struct.deleted` check); only the redo set excludes them.
// 2. When nothing changed, the fallback bytes were not a decodable V2 update; return a real empty update.
// Throwaway spike code; the copy target for P3-A's restore.
import * as Y from '@y/y'

const idsOf = doc => Y.createContentIdsFromDoc(doc, true)
const EMPTY = Y.encodeStateAsUpdateV2(new Y.Doc())

export const revertUpdateFixed = (oldState, liveState) => {
  const scratch = new Y.Doc({ gc: false })
  Y.applyUpdateV2(scratch, oldState)
  const oldIds = idsOf(scratch)
  Y.applyUpdateV2(scratch, liveState)
  const since = Y.excludeContentIds(idsOf(scratch), oldIds)
  let update = null
  scratch.on('updateV2', u => { update = update ? Y.mergeUpdatesV2([update, u]) : u })
  const um = new Y.UndoManager(scratch)
  um.undoStack.push({ inserts: since.inserts, deletes: Y.diffIdSet(since.deletes, since.inserts), meta: new Map() })
  um.undo()
  um.destroy()
  scratch.destroy()
  return update ?? EMPTY
}
