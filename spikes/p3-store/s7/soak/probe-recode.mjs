// S7a probe: what the retained version chain of a finished soak store would weigh if thinning re-derived each folded
// delta from the reconstructed states (gc'd: content inserted and deleted between two retained versions shrinks to
// ContentDeleted) instead of merging the dropped deltas (`mergeUpdatesV2`, which keeps that content), and if keyframes
// were re-derived as deltas too (one keyframe only). Also zstd of the whole chain.
// Usage: node spikes/p3-store/s7/soak/probe-recode.mjs doc-heavy-delta
import * as Y from '@y/y'
import { zstdCompressSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'
import { Store } from './store.mjs'

const tag = process.argv[2] ?? 'doc-heavy-delta'
const store = new Store(`/tmp/p3-s7a/${tag}.sqlite`, { encoding: 'delta' }, { fresh: false })
const rows = store.db.prepare('SELECT seq, enc, bytes FROM versions ORDER BY seq').all()
const t0 = performance.now()
let doc = null; let prevIds = null; let prevSV = null
let stored = 0; let regc = 0; let regcNoKf = 0; let zAll = 0; let firstKf = 0; let kfBytes = 0
for (const r of rows) {
  stored += r.bytes.length; zAll += zstdCompressSync(r.bytes).length
  if (!doc) { doc = new Y.Doc(); Y.applyUpdateV2(doc, r.bytes); firstKf = r.bytes.length } else Y.applyUpdateV2(doc, r.bytes)
  if (r.enc === 'full') kfBytes += r.bytes.length
  const ids = Y.createContentIdsFromDoc(doc, true)
  if (prevIds) {
    const since = Y.excludeContentIds(ids, prevIds)
    const u = Y.encodeStateAsUpdateV2(doc, prevSV)
    const d = Y.intersectUpdateWithContentIdsV2(u, Y.createContentIds(Y.createContentIdsFromUpdateV2(u).inserts, since.deletes))
    regcNoKf += d.length
    regc += r.enc === 'full' ? r.bytes.length : d.length
  }
  prevIds = ids; prevSV = Y.encodeStateVector(doc)
}
console.log(JSON.stringify({
  tag, rows: rows.length, storedMB: +(stored / 1048576).toFixed(2), keyframesMB: +(kfBytes / 1048576).toFixed(2),
  regcDeltasKeepKeyframesMB: +((regc + firstKf) / 1048576).toFixed(2), regcOneKeyframeMB: +((regcNoKf + firstKf) / 1048576).toFixed(2),
  zstdStoredMB: +(zAll / 1048576).toFixed(2), liveStateMB: +(Y.encodeStateAsUpdateV2(doc).length / 1048576).toFixed(2), ms: Math.round(performance.now() - t0)
}))
process.exit(0)
