// S3 (P3-0): provenance that survives compaction. Every update the host logs gets a ContentMap row at landing
// (`(client, clock range) → insert/delete actor and time`, S1's build), stored apart from the update bytes; compaction
// folds the update log into a full V2 state (gc on) and drops the log rows, never the provenance rows. Diffs and
// "Show editors" read only provenance, so they are the same before and after a compaction.
// Throwaway spike code (copy target for P3-A).
import * as Y from '@y/y'

/** One update's provenance (S1's attribution build). `v2` is the update in V2 encoding. */
export const contentMapOf = (v2, actor, at) => Y.createContentMapFromContentIds(
  Y.createContentIdsFromUpdateV2(v2),
  [Y.createContentAttribute('insert', actor), Y.createContentAttribute('insertAt', at)],
  [Y.createContentAttribute('delete', actor), Y.createContentAttribute('deleteAt', at)]
)

/**
 * The host-side store for one artifact: the update log (seq, actor, at, bytes), version states, and provenance rows
 * (seq, at, actor, encoded ContentMap) written as each update lands. `attach(hub)` mirrors S1's hub log.
 */
export const createStore = () => {
  const store = {
    log: [], // { seq, actor, at, v2 }
    provenance: [], // { seq, at, actor, bytes }   (never folded away)
    versions: [], // { seq, at, actor, kind, label, state }   (full V2 states, gc on)
    base: null, // { seq, state } the compacted prefix of the log
    land (entry) {
      store.log.push(entry)
      store.provenance.push({ seq: entry.seq, at: entry.at, actor: entry.actor, bytes: Y.encodeContentMap(contentMapOf(entry.v2, entry.actor, entry.at)) })
    },
    version (hostDoc, { seq, at, actor, kind, label }) {
      const v = { seq, at, actor, kind, label, state: Y.encodeStateAsUpdateV2(hostDoc) }
      store.versions.push(v)
      return v
    },
    /** Fold every log row with seq ≤ `uptoSeq` into the base state; provenance rows stay. Returns the dropped bytes. */
    compact (uptoSeq) {
      const folded = store.log.filter(e => e.seq <= uptoSeq)
      const doc = new Y.Doc() // gc on: the compacted state is what a reload would hold
      if (store.base) Y.applyUpdateV2(doc, store.base.state)
      for (const e of folded) Y.applyUpdateV2(doc, e.v2)
      store.base = { seq: uptoSeq, state: Y.encodeStateAsUpdateV2(doc) }
      store.log = store.log.filter(e => e.seq > uptoSeq)
      return { rows: folded.length, bytes: folded.reduce((s, e) => s + e.v2.length, 0), baseBytes: store.base.state.length }
    },
    /** Bucket provenance rows older than `beforeSeq` into one merged row (the 30-day minute buckets of §4.2). */
    bucket (beforeSeq) {
      const old = store.provenance.filter(r => r.seq < beforeSeq)
      if (old.length < 2) return 0
      const merged = Y.mergeContentMaps(old.map(r => Y.decodeContentMap(r.bytes)))
      store.provenance = [{ seq: old[old.length - 1].seq, at: old[old.length - 1].at, actor: '*', bytes: Y.encodeContentMap(merged) }, ...store.provenance.filter(r => r.seq >= beforeSeq)]
      return old.length
    },
    /** All provenance as one ContentMap (the DiffRenderer intersects it with the diff, so a superset is fine). */
    attributions () { return Y.mergeContentMaps(store.provenance.map(r => Y.decodeContentMap(r.bytes))) },
    /** Provenance for a seq window only (what a log-window build gives before compaction). */
    attributionsFromLog (fromSeqExcl, toSeqIncl) {
      return Y.mergeContentMaps(store.log.filter(e => e.seq > fromSeqExcl && e.seq <= toSeqIncl).map(e => contentMapOf(e.v2, e.actor, e.at)))
    },
    provenanceBytes () { return store.provenance.reduce((s, r) => s + r.bytes.length, 0) }
  }
  return store
}

/** Read an attribution range's attributes into {insert, insertAt, delete, deleteAt}. */
export const attrsOf = attrs => {
  const o = {}
  for (const a of attrs ?? []) o[a.name] = a.val
  return o
}
