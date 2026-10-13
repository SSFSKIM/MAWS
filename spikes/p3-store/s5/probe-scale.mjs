// S5 probe: the cost of deriving comment state by scanning, at S7's scale (a ~200-page document: 4,000 paragraphs,
// 300 comment threads). liveRanges over the ProseMirror doc (the display plugin, per doc change, as written) and
// liveIdsY over the Y root (the host's orphan derivation per applied update). Medians of 9. Run:
//   node spikes/p3-store/s5/probe-scale.mjs      (writes out/scale.txt)
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import { pmnodeToDelta } from '@y/prosemirror'
import { schemaFor } from './lib/schema.mjs'
import { liveRanges, liveIdsY, markExtentY } from './lib/comments.mjs'

const schema = schemaFor({ generateID: (() => { let n = 0; return () => 'b' + (++n) })() })
const P = 4000; const C = 300
const words = 'the plan ships quarterly with design review notes owners track budget risks timeline metrics'.split(' ')
const paras = []
for (let i = 0; i < P; i++) {
  const t = Array.from({ length: 40 }, (_, k) => words[(i + k) % words.length]).join(' ') + '.'
  const c = i % Math.floor(P / C) === 0 && paras.length / Math.floor(P / C) < C
  paras.push(schema.nodes.paragraph.create({ id: 'p' + i }, c
    ? [schema.text(t.slice(0, 20)), schema.text(t.slice(20, 60), [schema.marks.comment.create({ threadId: 't' + i })]), schema.text(t.slice(60))]
    : [schema.text(t)]))
}
const pm = schema.nodes.doc.create(null, paras)
const doc = new Y.Doc(); const root = doc.get('default')
root.applyDelta(pmnodeToDelta(pm))
const med = f => { const xs = []; for (let i = 0; i < 9; i++) { const t = performance.now(); f(); xs.push(performance.now() - t) } return xs.sort((a, b) => a - b)[4] }
const lines = [
  `doc: ${P} paragraphs, ${pm.content.size} PM positions, ${liveRanges(pm).size} threads; V2 state ${Y.encodeStateAsUpdateV2(doc).length} B`,
  `liveRanges(pmDoc) [display plugin, per doc change as written]: ${med(() => liveRanges(pm)).toFixed(1)} ms`,
  `liveIdsY(root) [host orphan derivation, per applied update as written]: ${med(() => liveIdsY(root)).toFixed(1)} ms`,
  `markExtentY(root, one thread) [the refresh, per thread]: ${med(() => markExtentY(root, 't' + (P - Math.floor(P / C)))).toFixed(1)} ms`
]
for (const l of lines) console.log(l)
writeFileSync(new URL('./out/scale.txt', import.meta.url), lines.join('\n') + '\n')
process.exit(0)
