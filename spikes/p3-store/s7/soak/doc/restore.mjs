// COPY of spikes/p3-store/s3/lib/restore.mjs at 4ab6b9b7 for S7a (unchanged below this line).
// S3 (P3-0): artifact-wide restore, two mechanisms, each producing ONE update that the host applies as the
// restorer's transaction (origin { actor }), so it is logged, attributed and broadcast like any other write and merges
// with concurrent edits by the CRDT rule. Kind-agnostic: both work on the whole Y.Doc (every tab, the threads map, the
// deck and slide maps). Throwaway spike code (copy target for P3-A: mechanism (a), `revertUpdate`).
import * as Y from '@y/y'
import * as delta from 'lib0/delta'

const idsOf = doc => Y.createContentIdsFromDoc(doc, true)

/**
 * (a) Revert: the content changes since the version, undone. A scratch doc (gc off) holds the old state first and the
 * live state over it, so content deleted since the version is still there to bring back (the live doc is gc on and
 * has dropped it). The changes since the version are exactly `ids(live) − ids(old)`; `Y.undoContentIds` (v14's
 * UndoManager over the whole doc) deletes what was inserted since and re-inserts what was deleted since, in place.
 * Returns the update (V2) the scratch doc emitted.
 */
export const revertUpdate = (oldState, liveState) => {
  const scratch = new Y.Doc({ gc: false })
  Y.applyUpdateV2(scratch, oldState)
  const oldIds = idsOf(scratch)
  Y.applyUpdateV2(scratch, liveState)
  const since = Y.excludeContentIds(idsOf(scratch), oldIds)
  let update = null
  scratch.on('updateV2', u => { update = update ? Y.mergeUpdatesV2([update, u]) : u })
  Y.undoContentIds(scratch, since)
  scratch.destroy()
  return update ?? new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
}

/**
 * (b) Structural diff: per root type, `delta.diff(live, old)` over the deep deltas, applied to a replica of the live
 * doc with `applyDelta` (text and child nodes by delta diff, attributes and map keys by key diff). `compare` decides
 * which old and live child nodes pair up (default: same name; `byId` also requires the same `id` attribute).
 */
export const diffUpdate = (oldState, liveState, { compare } = {}) => {
  const old = new Y.Doc(); Y.applyUpdateV2(old, oldState)
  const live = new Y.Doc(); Y.applyUpdateV2(live, liveState)
  let update = null
  live.on('updateV2', u => { update = update ? Y.mergeUpdatesV2([update, u]) : u })
  live.transact(() => {
    for (const name of new Set([...old.share.keys(), ...live.share.keys()])) {
      const d = delta.diff(live.get(name).toDeltaDeep(), old.get(name).toDeltaDeep(), compare ? { compare } : {})
      if (!d.isEmpty()) live.get(name).applyDelta(materialize(d))
    }
  })
  return update
}
const idOf = d => d.attrs?.id?.value
export const byId = (a, b) => a.name === b.name && idOf(a) === idOf(b)

/**
 * setAttr ops whose value is a delta must become YNodes before `applyDelta` (v14's nodeMapSet takes YNodes, not
 * deltas, and `Y.Node.from` converts only one level), at every depth.
 */
const toNode = d => Y.Node.from(materialize(d))
const materialize = d => {
  const out = delta.create(d.name)
  for (const op of d.children) {
    if (delta.$textOp.check(op)) out.insert(op.insert, op.format)
    else if (delta.$insertOp.check(op)) out.insert(op.insert.map(x => (delta.$deltaAny.check(x) ? toNode(x) : x)), op.format)
    else if (delta.$retainOp.check(op)) out.retain(op.retain, op.format)
    else if (delta.$deleteOp.check(op)) out.delete(op.delete)
    else if (delta.$modifyOp.check(op)) out.modify(materialize(op.value), op.format)
  }
  for (const op of d.attrs) {
    if (delta.$setAttrOp.check(op)) out.setAttr(op.key, delta.$deltaAny.check(op.value) ? toNode(op.value) : op.value)
    else if (delta.$deleteAttrOp.check(op)) out.deleteAttr(op.key)
    else out.modifyAttr(op.key, materialize(op.value))
  }
  return out.done()
}
