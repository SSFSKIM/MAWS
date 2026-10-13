// S1 side check (not S7): per-keystroke cost of the v13 and v14 bindings on a ~500-block document in happy-dom
// (ProseMirror view work included, layout not), first bind, and a remote agent edit applied into the editor.
//   node spikes/p3-store/s1/v14/s1-perf.mjs   (writes out/perf.json)
import { tick } from '../lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import { Editor } from '@tiptap/core'
import { pmnodeToDelta } from '@y/prosemirror'
import { extensions, schemaFor } from './schema.mjs'
import { YCollaboration } from './collab.mjs'
import { Y13, Editor13, getSchema13, StarterKit13, Table13, TableRow13, TableCell13, TableHeader13, UniqueID13, Collaboration13, prosemirrorToYXmlFragment } from '../v13/mods.mjs'

const BLOCKS = 500
const words = 'the agent and the owner edit a long document about plans risks and dates together'.split(' ')
const para = i => ({ type: 'paragraph', attrs: { id: 'p' + i }, content: [{ type: 'text', text: Array.from({ length: 40 }, (_, k) => words[(i + k) % words.length]).join(' ') + '.' }] })
const docJSON = { type: 'doc', content: Array.from({ length: BLOCKS }, (_, i) => i % 25 === 0 ? { type: 'heading', attrs: { level: 2, id: 'h' + i }, content: [{ type: 'text', text: 'Section ' + i }] } : para(i)) }
const BT = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length * p)] * 100) / 100 }

const bench = async (label, makeDoc, makeEditor, remoteEdit) => {
  const doc = makeDoc()
  const el = document.createElement('div'); document.body.appendChild(el)
  const t0 = performance.now()
  const ed = makeEditor(doc, el)
  await tick(0); await tick(0)
  const bindMs = performance.now() - t0
  const mid = Math.floor(ed.state.doc.content.size / 2)
  ed.commands.setTextSelection(mid)
  const times = []
  for (let k = 0; k < 300; k++) {
    const s = performance.now()
    ed.view.dispatch(ed.state.tr.insertText('x'))
    times.push(performance.now() - s)
  }
  const remote = []
  for (let k = 0; k < 50; k++) { const s = performance.now(); remoteEdit(doc, k); remote.push(performance.now() - s) }
  await tick(0)
  ed.destroy(); el.remove()
  return { label, chars: docJSON.content.length + ' blocks', bindMs: Math.round(bindMs), keystrokeMs: { p50: pct(times, 0.5), p95: pct(times, 0.95), max: pct(times, 0.999) }, remoteEditMs: { p50: pct(remote, 0.5), p95: pct(remote, 0.95) } }
}

const s14 = schemaFor()
const r14 = await bench('v14 @y/prosemirror 2.0.0-15', () => { const d = new Y.Doc(); d.get('default').applyDelta(pmnodeToDelta(s14.nodeFromJSON(docJSON))); return d },
  (d, el) => new Editor({ element: el, extensions: [...extensions(), YCollaboration.configure({ ytype: d.get('default') })] }),
  (d, k) => { const other = d._o ??= (() => { const o = new Y.Doc(); Y.applyUpdate(o, Y.encodeStateAsUpdate(d)); return o })(); other.get('default').get(10 + k).insert(0, 'agent '); Y.applyUpdate(d, Y.encodeStateAsUpdate(other, Y.encodeStateVector(d))) })
const ex13 = () => [StarterKit13.configure({ undoRedo: false }), Table13, TableRow13, TableCell13, TableHeader13, UniqueID13.configure({ types: BT })]
const s13 = getSchema13(ex13())
const r13 = await bench('v13 @tiptap/y-tiptap 3.0.9', () => { const d = new Y13.Doc(); prosemirrorToYXmlFragment(s13.nodeFromJSON(docJSON), d.getXmlFragment('default')); return d },
  (d, el) => new Editor13({ element: el, extensions: [...ex13(), Collaboration13.configure({ document: d })] }),
  (d, k) => { const other = d._o ??= (() => { const o = new Y13.Doc(); Y13.applyUpdate(o, Y13.encodeStateAsUpdate(d)); return o })(); other.getXmlFragment('default').get(10 + k).get(0).insert(0, 'agent '); Y13.applyUpdate(d, Y13.encodeStateAsUpdate(other, Y13.encodeStateVector(d))) })
for (const r of [r13, r14]) console.log(JSON.stringify(r))
writeFileSync(new URL('../out/perf.json', import.meta.url), JSON.stringify([r13, r14], null, 2))
process.exit(0)
