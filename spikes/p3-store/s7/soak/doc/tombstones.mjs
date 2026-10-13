// S7a (P3-0): tombstone growth with gc on. The 200-page document under two churns far beyond the soak's: (a) an agent
// rewriting the same section again and again (80 % of its words replaced per pass, word-level hunks, a new session each
// pass), (b) a human typing and deleting in one paragraph. After every step: the live V2 state, the same state re-encoded
// through a fresh doc, a fresh import of the same content (no history), the struct count. Answers whether the live state
// grows without bound and whether re-encoding helps. (a′) writes the same rewrites as whole-paragraph replacements.
// Usage: node spikes/p3-store/s7/soak/doc/tombstones.mjs [passes=1000]
import * as Y from '@y/y'
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror'
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { schemaFor } from './schema.mjs'
import { bigDocJSON, rng, word, sentence } from './corpus.mjs'

const passes = Number(process.argv[2] ?? 1000)
const schema = schemaFor({ uniqueId: false })
const r = rng(5)
const doc = new Y.Doc({ gc: true })
doc.transact(() => { const tab = new Y.Node('tab'); doc.get('tabs').setAttr('t1', tab); const b = new Y.Node('doc'); tab.setAttr('body', b); b.applyDelta(pmnodeToDelta(schema.nodeFromJSON(bigDocJSON(310, 42).json))) })
const body = doc.get('tabs').getAttr('t1').getAttr('body')
const top = () => body.toArray().filter(n => n instanceof Y.Node)
const plain = p => { let s = ''; for (const op of p.toDelta().children) s += typeof op.insert === 'string' ? op.insert : '￼'.repeat(op.insert?.length ?? 1); return s }
const spans = s => { const out = []; const re = /[^\s￼]+/g; let m; while ((m = re.exec(s))) out.push([m.index, m[0].length]); return out }
const measure = (label, step) => {
  const t0 = performance.now()
  const live = Y.encodeStateAsUpdateV2(doc)
  const d = new Y.Doc(); Y.applyUpdateV2(d, live); const re = Y.encodeStateAsUpdateV2(d).length; d.destroy()
  const f = new Y.Doc(); f.transact(() => { const b = new Y.Node('doc'); f.get('body').insert(0, [b]); b.applyDelta(pmnodeToDelta(ynodeToPmnode(body, schema))) }); const fresh = Y.encodeStateAsUpdateV2(f).length; f.destroy()
  let structs = 0; let deletedStructs = 0
  doc.store.clients.forEach(ss => { structs += ss.length; for (const s of ss) if (s.deleted) deletedStructs++ })
  const row = { label, step, live: live.length, reencoded: re, freshImport: fresh, tombstoneBytes: live.length - fresh, structs, deletedStructs, clients: doc.store.clients.size, ms: Math.round(performance.now() - t0) }
  rows.push(row); console.log(JSON.stringify(row))
}
const rows = []
measure('start', 0)
// (a) the same section rewritten, a fresh agent client each pass
const h2 = top().findIndex(n => n.name === 'heading' && n.getAttr('level') === 2 && n.getAttr('id') === 's100h')
const section = top().slice(h2 + 1, h2 + 8).filter(n => n.name === 'paragraph')
let client = 5000
for (let k = 1; k <= passes; k++) {
  doc.clientID = client++
  doc.transact(() => { for (const p of section) { const sp = spans(plain(p)); for (let i = sp.length - 1; i >= 0; i--) if (r() < 0.8) { p.delete(sp[i][0], sp[i][1]); p.insert(sp[i][0], word(r)) } } })
  if (k % (passes / 10) === 0) measure('rewrite-section', k)
}
// (a′) the same rewrites of another section written as whole-paragraph replacements (one delete of the old text and
// one insert of the new, the shape a writer would use above a changed-words threshold)
const h2b = top().findIndex(n => n.name === 'heading' && n.getAttr('level') === 2 && n.getAttr('id') === 's150h')
const section2 = top().slice(h2b + 1, h2b + 8).filter(n => n.name === 'paragraph')
for (let k = 1; k <= passes; k++) {
  doc.clientID = client++
  doc.transact(() => { for (const p of section2) { const s = plain(p); if (/￼/.test(s)) continue; const out = s.split(' ').map(w => (r() < 0.8 ? word(r) : w)).join(' '); p.delete(0, p.length); p.insert(0, out) } })
  if (k % (passes / 10) === 0) measure('replace-paragraphs', k)
}
// (b) one paragraph typed into and backspaced, 100k keystrokes in sessions of 2,000 (a new editor client each)
const p = top().find(n => n.name === 'paragraph' && n.getAttr('id') === 's200p3')
let stream = ''
for (let k = 1; k <= 100_000; k++) {
  if (k % 2000 === 1) doc.clientID = client++
  const len = p.length
  doc.transact(() => {
    if (r() < 0.45 && len > 50) p.delete(Math.floor(r() * len), 1)
    else { if (!stream) stream = ' ' + sentence(r); p.insert(Math.floor(r() * len), stream[0]); stream = stream.slice(1) }
  })
  if (k % 10_000 === 0) measure('type-delete-paragraph', k)
}
writeFileSync(new URL('../../out/tombstones.json', import.meta.url), JSON.stringify(rows, null, 1))
process.exit(0)
