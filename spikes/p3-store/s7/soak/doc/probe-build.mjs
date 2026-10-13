// S7a probe: build the 200-page document through the v14 writer; sizes and the per-keystroke cost on it.
import * as Y from '@y/y'
import { pmnodeToDelta } from '@y/prosemirror'
import { performance } from 'node:perf_hooks'
import { schemaFor } from './schema.mjs'
import { bigDocJSON, countText } from './corpus.mjs'

const schema = schemaFor({ uniqueId: false })
let t0 = performance.now()
const { json, threads } = bigDocJSON(400)
const pm = schema.nodeFromJSON(json)
const counts = countText(json)
console.log('generate+PM', Math.round(performance.now() - t0), 'ms', counts, 'threads', threads.length)
t0 = performance.now()
const doc = new Y.Doc()
doc.transact(() => {
  const tab = new Y.Node('tab'); doc.get('tabs').setAttr('t1', tab)
  tab.setAttr('title', 'Main'); tab.setAttr('order', 'a0')
  const body = new Y.Node('doc'); tab.setAttr('body', body)
  body.applyDelta(pmnodeToDelta(pm))
})
console.log('import', Math.round(performance.now() - t0), 'ms')
t0 = performance.now()
const v2 = Y.encodeStateAsUpdateV2(doc)
console.log('encode V2', Math.round(performance.now() - t0), 'ms', v2.length, 'B; V1', Y.encodeStateAsUpdate(doc).length)
t0 = performance.now()
const d2 = new Y.Doc(); Y.applyUpdateV2(d2, v2)
console.log('load V2', Math.round(performance.now() - t0), 'ms')
const body = doc.get('tabs').getAttr('t1').getAttr('body')
const kids = body.toArray()
console.log('top-level blocks', kids.length)
const ups = []; doc.on('update', u => ups.push(u))
t0 = performance.now()
let p = kids.slice(1500).find(k => k.name === 'paragraph' && k.length > 20); let off = 10
for (let i = 0; i < 5000; i++) { doc.transact(() => p.insert(off++, 'abcdefghij'[i % 10])) }
const dt = performance.now() - t0
console.log('5000 keystrokes', Math.round(dt), 'ms', (dt / 5000).toFixed(3), 'ms each; bytes', ups.reduce((s, u) => s + u.length, 0))
t0 = performance.now()
const ids = Y.createContentIdsFromDoc(doc, true)
console.log('ids from doc', Math.round(performance.now() - t0), 'ms')
t0 = performance.now()
const sv = Y.encodeStateVector(d2)
const diff = Y.encodeStateAsUpdateV2(doc, sv)
console.log('diff since', Math.round(performance.now() - t0), 'ms', diff.length)
