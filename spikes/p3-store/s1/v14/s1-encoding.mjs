// S1 scenario 6: encoding and storage, v13 and v14 in one process.
// (a) the one-way rule, run: v13 bytes (written by a v13 Tiptap editor) load in v14 and render the same; a v14 editor
//     edits them; then the v13 side gets the v14-written bytes, headless and through a v13 Tiptap binding.
// (b) sizes for the same history (one transaction per keystroke-sized op), V1/V2, gc on/off, log, load time.
//   node spikes/p3-store/s1/v14/s1-encoding.mjs   (writes out/encoding.json)
import { tick } from '../lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import { Editor } from '@tiptap/core'
import { ynodeToPmnode } from '@y/prosemirror'
import { extensions, schemaFor } from './schema.mjs'
import { YCollaboration } from './collab.mjs'
import { Y13, Editor13, getSchema13, StarterKit13, Table13, TableRow13, TableCell13, TableHeader13, UniqueID13, Collaboration13, prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '../v13/mods.mjs'
import { seedJSON } from '../lib/history-fixture.mjs'
import { simulate } from '../lib/history-sim.mjs'

const out = { oneWay: {}, sizes: {} }
const log = (k, v) => { console.log(k.padEnd(64), typeof v === 'string' ? v : JSON.stringify(v)); return v }
const BT = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']
const exts13 = () => [StarterKit13.configure({ undoRedo: false }), Table13, TableRow13, TableCell13, TableHeader13, UniqueID13.configure({ types: BT })]
const schema13 = getSchema13(exts13())
const schema14 = schemaFor()

// ── (a) one-way ──
// a v13 document written the way MAWS-on-v13 would write it: host import + a v13 Tiptap editor typing into it
const d13 = new Y13.Doc()
d13.transact(() => prosemirrorToYXmlFragment(schema13.nodeFromJSON(seedJSON), d13.getXmlFragment('default')))
const el13 = document.createElement('div'); document.body.appendChild(el13)
const ed13 = new Editor13({ element: el13, extensions: [...exts13(), Collaboration13.configure({ document: d13 })] })
await tick(); await tick()
ed13.chain().setTextSelection(3).insertContent('v13 typed ').setMark('bold').run()
await tick()
const v13bytesV2 = Y13.encodeStateAsUpdateV2(d13)
const v13bytesV1 = Y13.encodeStateAsUpdate(d13)
const v13json = yXmlFragmentToProseMirrorRootNode(d13.getXmlFragment('default'), schema13).toJSON()

const d14 = new Y.Doc()
Y.applyUpdateV2(d14, v13bytesV2)
const r14 = ynodeToPmnode(d14.get('default'), schema14).toJSON()
out.oneWay.v14ReadsV13V2 = log('v14 reads v13 V2 bytes, renders the same PM JSON', JSON.stringify(r14) === JSON.stringify(v13json))
const d14b = new Y.Doc(); Y.applyUpdate(d14b, v13bytesV1)
out.oneWay.v14ReadsV13V1 = log('v14 reads v13 V1 bytes, renders the same PM JSON', JSON.stringify(ynodeToPmnode(d14b.get('default'), schema14).toJSON()) === JSON.stringify(v13json))
// bind a v14 editor to the v13-written doc: does binding alone write (the documented one-time normalizations)?
let bindWrites = 0
d14.on('update', () => bindWrites++)
const el14 = document.createElement('div'); document.body.appendChild(el14)
const ed14 = new Editor({ element: el14, extensions: [...extensions(), YCollaboration.configure({ ytype: d14.get('default') })] })
await tick(); await tick()
out.oneWay.v14BindWritesOnV13Doc = log('v14 editor bound to a v13 doc: Y updates written by binding alone', bindWrites)
out.oneWay.v14EditorShowsV13 = log('v14 editor shows the v13 content', JSON.stringify(ed14.getJSON()) === JSON.stringify(v13json))
ed14.chain().setTextSelection(ed14.state.doc.content.size - 2).insertContent(' v14 typed').run()
ed14.chain().setTextSelection(1).insertContent([{ type: 'paragraph', content: [{ type: 'text', text: 'A paragraph written by v14' }] }]).run()
await tick()
const mixed = Y.encodeStateAsUpdateV2(d14)
const mixedV1 = Y.encodeStateAsUpdate(d14)
log('v14 edits on the v13 doc', ed14.getText().replace(/\n+/g, ' | ').slice(0, 140))
// now the v13 side receives the v14-written bytes
const back13 = new Y13.Doc()
let decodeErr = null
try { Y13.applyUpdateV2(back13, mixed) } catch (e) { decodeErr = e.message }
out.oneWay.v13DecodesV14Bytes = log('v13 decodes the v14-written update', decodeErr ?? 'no throw')
let renderErr = null; let r13 = null
try { r13 = yXmlFragmentToProseMirrorRootNode(back13.getXmlFragment('default'), schema13).toJSON() } catch (e) { renderErr = e.message }
out.oneWay.v13HeadlessRender = log('v13 headless render (yXmlFragmentToProseMirrorRootNode)', renderErr ? 'throws: ' + renderErr.slice(0, 120) : JSON.stringify(r13).slice(0, 160))
const v13text = r13 ? JSON.stringify(r13) : ''
out.oneWay.v13SeesV14Text = log('v13 headless render contains the v14-typed text', v13text.includes('v14 typed') && v13text.includes('written by v14'))
// and through a v13 Tiptap binding (a stale client): what does it do to the doc?
let writes13 = 0; const sizeBefore = Y13.encodeStateAsUpdateV2(back13).length
back13.on('update', () => writes13++)
const errs = []; const oe = console.error; console.error = (...a) => errs.push(String(a[0]).slice(0, 120))
let bindErr = null; let edStale = null
try {
  const elS = document.createElement('div'); document.body.appendChild(elS)
  edStale = new Editor13({ element: elS, extensions: [...exts13(), Collaboration13.configure({ document: back13 })] })
  await tick(); await tick(); await tick()
} catch (e) { bindErr = e.message }
console.error = oe
const staleText = edStale?.getText()?.replace(/\n+/g, ' | ')
out.oneWay.v13BindingOnV14Doc = log('v13 Tiptap binding on the v14-written doc', { bindErr, consoleErrors: errs.slice(0, 3), editorText: staleText?.slice(0, 160), updatesWrittenByStaleClient: writes13 })
out.oneWay.staleClientDeletedContent = log('stale v13 client wrote to its doc (would sync to peers)', writes13 > 0)
// the stale client's writes reaching v14 peers
if (writes13 > 0) {
  const peer = new Y.Doc(); Y.applyUpdateV2(peer, mixed)
  Y.applyUpdateV2(peer, Y13.encodeStateAsUpdateV2(back13, Y13.encodeStateVectorFromUpdateV2(mixed)))
  const peerJSON = ynodeToPmnode(peer.get('default'), schema14).toJSON()
  out.oneWay.v14PeerAfterStaleWrites = log('a v14 peer after receiving the stale v13 client\'s writes', { lostV14Paragraph: !JSON.stringify(peerJSON).includes('written by v14'), lostV14Typing: !JSON.stringify(peerJSON).includes('v14 typed'), text: JSON.stringify(peerJSON).replace(/"type":"|"attrs":\{[^}]*\},?|"content":|\{|\}|\[|\]|"text":|"marks":/g, '').slice(0, 200) })
}
out.oneWay.sizes = { v13StateV2: v13bytesV2.length, afterV14EditsV2: mixed.length, afterV14EditsV1: mixedV1.length }

// ── (b) sizes for the same history ──
const adapter13 = (doc) => {
  const f = doc.getXmlFragment('default')
  const blocks = () => f.toArray()
  const txt = el => el.get(0)
  return {
    blocks: () => f.length, len: i => txt(blocks()[i]).length,
    insert: (i, p, s) => txt(blocks()[i]).insert(p, s), del: (i, p, n) => txt(blocks()[i]).delete(p, n),
    bold: (i, p, n, on) => txt(blocks()[i]).format(p, n, { bold: on ? {} : null }),
    addBlock: (after, s) => { const e = new Y13.XmlElement('paragraph'); e.setAttribute('id', 'n' + f.length); e.insert(0, [new Y13.XmlText(s)]); f.insert(after + 1, [e]) },
    transact: fn => doc.transact(fn)
  }
}
const adapter14 = (doc) => {
  const t = doc.get('default')
  const blocks = () => t.toArray()
  return {
    blocks: () => t.length, len: i => blocks()[i].length,
    insert: (i, p, s) => blocks()[i].insert(p, s), del: (i, p, n) => blocks()[i].delete(p, n),
    bold: (i, p, n, on) => blocks()[i].format(p, n, { bold: on ? {} : null }),
    addBlock: (after, s) => { const d = schema14.nodes.paragraph.create({ id: 'n' + t.length }, schema14.text(s)); t.insert(after + 1, [ynodeToPmnodeDelta(d)]) },
    transact: fn => doc.transact(fn)
  }
}
const { pmnodeToDelta } = await import('@y/prosemirror')
const ynodeToPmnodeDelta = d => pmnodeToDelta(d)
const flatSeed = { type: 'doc', content: Array.from({ length: 12 }, (_, i) => ({ type: 'paragraph', attrs: { id: 'p' + i }, content: [{ type: 'text', text: 'Seed paragraph number ' + i + ' with some words.' }] })) }
const measure = (label, make, Yx, adapter, root) => {
  const res = {}
  for (const gc of [true, false]) {
    const doc = make(gc)
    let logBytes = 0; let updates = 0
    doc.on('updateV2', u => { logBytes += u.length; updates++ })
    const t0 = performance.now()
    simulate(adapter(doc), { ops: 20000 })
    const ms = performance.now() - t0
    const v2 = Yx.encodeStateAsUpdateV2(doc); const v1 = Yx.encodeStateAsUpdate(doc)
    const t1 = performance.now(); const re = new Yx.Doc({ gc }); Yx.applyUpdateV2(re, v2); const loadMs = performance.now() - t1
    res[gc ? 'gcOn' : 'gcOff'] = { visibleChars: root(doc).toString().replace(/<[^>]*>/g, '').length, stateV2: v2.length, stateV1: v1.length, logV2: logBytes, updates, replayMs: Math.round(ms), loadMs: Math.round(loadMs * 10) / 10 }
  }
  return log(label, res)
}
out.sizes.v13 = measure('v13 (yjs 13.6.33), 20k ops', gc => { const d = new Y13.Doc({ gc }); prosemirrorToYXmlFragment(schema13.nodeFromJSON(flatSeed), d.getXmlFragment('default')); return d }, Y13, adapter13, d => d.getXmlFragment('default'))
out.sizes.v14 = measure('v14 (@y/y 14.0.0-rc.28), 20k ops', gc => { const d = new Y.Doc({ gc }); d.get('default').applyDelta(pmnodeToDelta(schema14.nodeFromJSON(flatSeed))); return d }, Y, adapter14, d => d.get('default'))
// v14 reading the v13 history bytes and re-encoding them
const h13 = new Y13.Doc(); prosemirrorToYXmlFragment(schema13.nodeFromJSON(flatSeed), h13.getXmlFragment('default')); simulate(adapter13(h13), { ops: 20000 })
const h13bytes = Y13.encodeStateAsUpdateV2(h13)
const h14 = new Y.Doc(); Y.applyUpdateV2(h14, h13bytes)
out.sizes.v13HistoryLoadedInV14 = log('v13 20k-op history loaded in v14: same text, re-encoded V2 bytes', { sameText: h14.get('default').toString().replace(/<[^>]*>/g, '') === h13.getXmlFragment('default').toString().replace(/<[^>]*>/g, ''), v13Bytes: h13bytes.length, v14ReencodedBytes: Y.encodeStateAsUpdateV2(h14).length })
writeFileSync(new URL('../out/encoding.json', import.meta.url), JSON.stringify(out, null, 2))
process.exit(0)
