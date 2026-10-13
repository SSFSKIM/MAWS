// Provenance: `revertUpdate` copied from spikes/p3-store/s3/lib/restore.mjs (S3, P3-0, mechanism (a)), unchanged, so it
// runs on this package's single @y/y. Artifact-wide restore as ONE update: the content changes since the version,
// undone over the whole Y.Doc (every fragment, the threads map). Throwaway spike code.
import * as Y from '@y/y'

const idsOf = doc => Y.createContentIdsFromDoc(doc, true)

/**
 * S5's variant: restore the text, the marks and every thread's status, but never take back a conversation — messages
 * posted since the version are re-appended and threads created since are re-created (their marks stay reverted, so
 * they show as orphans). One host transaction, so one update.
 */
export const restoreKeepingConversation = (doc, oldState, origin) => {
  const threads = doc.get('threads')
  const before = new Map([...threads.attrEntries()].map(([id, t]) => [id, { attrs: Object.fromEntries(t.attrEntries()), messages: t.toArray() }]))
  const upd = revertUpdate(oldState, Y.encodeStateAsUpdateV2(doc))
  doc.transact(() => {
    Y.applyUpdateV2(doc, upd)
    for (const [id, was] of before) {
      let t = threads.getAttr(id)
      if (!t) { t = new Y.Node('thread'); threads.setAttr(id, t); for (const [k, v] of Object.entries(was.attrs)) t.setAttr(k, v) }
      const have = new Set(t.toArray().map(m => m.id))
      const missing = was.messages.filter(m => !have.has(m.id))
      if (missing.length) t.push(missing)
    }
  }, origin)
}

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
