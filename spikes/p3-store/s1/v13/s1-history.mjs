// S1 scenario 3 on Yjs v13: the same two stored full V2 states and edits as v14/s1-history.mjs, rendered by
// y-tiptap's Uint8Array (state-pair) snapshot mode inside Tiptap Collaboration, attributed by a PUD-shaped adapter
// built from the host's author log (getUserByClientId, getUserByDeletedId, dss). Two schemas: stock StarterKit
// (codeBlock marks '') and one whose codeBlock admits `ychange`. Run:
//   node spikes/p3-store/s1/v13/s1-history.mjs   (writes out/v13-history.json)
import { tick } from '../lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as aw from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Editor, Mark, Extension, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { UniqueID } from '@tiptap/extension-unique-id'
import Collaboration from '@tiptap/extension-collaboration'
import { prosemirrorToYXmlFragment, ySyncPluginKey } from '@tiptap/y-tiptap'
import { createHub } from '../lib/link.mjs'
import { tiptapSub } from '../lib/tiptap.mjs'
import { seedJSON, spans, score } from '../lib/history-fixture.mjs'

const { CodeBlock } = await tiptapSub(new URL('../../node_modules', import.meta.url).pathname)('extension-code-block')
const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']
const YChange = Mark.create({ name: 'ychange', inclusive: false, excludes: '', addAttributes: () => ({ user: { default: null }, type: { default: null }, color: { default: null } }), renderHTML: ({ HTMLAttributes }) => ['ychange', HTMLAttributes, 0] })
const YChangeAttr = Extension.create({ name: 'ychangeAttr', addGlobalAttributes: () => [{ types: BLOCK_TYPES, attributes: { ychange: { default: null, rendered: false } } }] })
const exts = codeAllowsYChange => [
  StarterKit.configure({ undoRedo: false, ...(codeAllowsYChange ? { codeBlock: false } : {}) }),
  ...(codeAllowsYChange ? [CodeBlock.extend({ marks: 'ychange' })] : []),
  Table, TableRow, TableCell, TableHeader, YChange, YChangeAttr,
  UniqueID.configure({ types: BLOCK_TYPES })
]

const run = async (codeAllowsYChange) => {
  const T0 = Date.parse('2026-10-12T09:00:00Z'); let fake = 0
  const schema = getSchema(exts(codeAllowsYChange))
  const hostDoc = new Y.Doc()
  const hub = createHub({ Y, sync, aw, encoding, decoding, hostDoc, clock: () => T0 + (++fake) * 1000 })
  const live = hostDoc.getXmlFragment('default')
  hostDoc.transact(() => prosemirrorToYXmlFragment(schema.nodeFromJSON(seedJSON), live), { actor: 'import' })
  const v1 = Y.encodeStateAsUpdateV2(hostDoc)

  // the PUD-shaped adapter, built from the log (and growing with it)
  const adapter = {
    clientToActor: new Map(), dss: new Map(),
    getUserByClientId (c) { return this.clientToActor.get(c) ?? null },
    getUserByDeletedId (id) { for (const [a, ds] of this.dss) if (Y.isDeleted(ds, id)) return a; return null },
    ingest (e) {
      const { structs, ds } = Y.decodeUpdateV2(e.v2)
      for (const s of structs) if ((s instanceof Y.Item || s instanceof Y.GC) && !this.clientToActor.has(s.id.client)) this.clientToActor.set(s.id.client, e.actor)
      if (ds.clients.size) this.dss.set(e.actor, Y.mergeDeleteSets([this.dss.get(e.actor) ?? Y.createDeleteSet(), ds]))
    }
  }

  const hDoc = new Y.Doc(); hub.connect(hDoc, 'human'); hub.flush()
  const el = document.createElement('div'); document.body.appendChild(el)
  const human = new Editor({ element: el, extensions: [...exts(codeAllowsYChange), Collaboration.configure({ document: hDoc, ySyncOptions: { permanentUserData: adapter, colors: [{ light: '#ecd44433', dark: '#ecd444' }] } })] })
  await tick(); hub.flush(); await tick()
  const settle = async () => { for (let i = 0; i < 3; i++) { hub.flush(); await tick() } }
  const findPos = (ed, needle) => { let at = -1; ed.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) }); return at }

  const aDoc = new Y.Doc(); hub.connect(aDoc, 'agent:session-1'); hub.flush()
  const aRoot = aDoc.getXmlFragment('default')
  const byId = (node, id) => { for (const c of node.toArray()) { if (c instanceof Y.XmlElement) { if (c.getAttribute('id') === id) return c; const r = byId(c, id); if (r) return r } } return null }
  const textOf = el => el.toArray().find(c => c instanceof Y.XmlText)
  const plainIndex = (t, needle) => t.toDelta().map(d => d.insert).join('').indexOf(needle)

  human.chain().setTextSelection(findPos(human, 'second sentence.') + 'second sentence.'.length).insertContent(' Added by human.').run(); await settle()
  human.chain().setTextSelection({ from: findPos(human, 'opening'), to: findPos(human, 'opening') + 7 }).setMark('bold').run(); await settle()
  human.chain().setTextSelection(findPos(human, 'Quarterly') + 2).setNode('heading', { level: 3 }).run(); await settle()
  human.chain().deleteRange({ from: findPos(human, 'Closing '), to: findPos(human, 'Closing ') + 8 }).run(); await settle()
  aDoc.transact(() => { const t = textOf(byId(aRoot, 'p1')); t.insert(plainIndex(t, ' It has'), ' (agent note)') }); await settle()
  aDoc.transact(() => { const t = textOf(byId(aRoot, 'p2')); const i = plainIndex(t, 'the middle of'); t.delete(i, 'the middle of'.length); t.insert(i, 'a part of') }); await settle()
  aDoc.transact(() => {
    const idx = aRoot.toArray().findIndex(c => c.getAttribute('id') === 'p2')
    const p = new Y.XmlElement('paragraph'); p.setAttribute('id', 'pA'); p.insert(0, [new Y.XmlText('Agent inserted paragraph.')])
    aRoot.insert(idx + 1, [p])
  }); await settle()
  aDoc.transact(() => { const c1 = byId(aRoot, 'c1'); const t = textOf(c1); const n = t.length; t.delete(n - 1, 1); t.insert(n - 1, '3\nconst c = 4'); c1.setAttribute('language', 'ts') }); await settle()
  aDoc.transact(() => { const t = textOf(byId(aRoot, 'td2p')); t.delete(0, 1); t.insert(0, '42') }); await settle()
  const v2 = Y.encodeStateAsUpdateV2(hostDoc)
  for (const e of hub.log) adapter.ingest(e)

  const liveBefore = live.toString()
  const errors = []
  const oe = console.error; console.error = (...a) => errors.push(String(a[0]).slice(0, 160))
  human.view.dispatch(human.state.tr.setMeta(ySyncPluginKey, { snapshot: v2, prevSnapshot: v1 }))
  await tick(); await tick()
  console.error = oe
  const json = human.getJSON()
  const read = (m) => {
    if (m.type === 'ychange') return { kind: m.attrs.type === 'added' ? 'ins' : 'del', who: m.attrs.user }
    if (m.type === '__nodeattrs' && m.attrs.ychange) return { kind: m.attrs.ychange.type === 'added' ? 'ins' : 'del', who: m.attrs.ychange.user }
    return null
  }
  const sp = spans(json, read)
  const sc = score(sp)
  const codeRendered = JSON.stringify(json).includes('const a = 1')
  const tableRendered = JSON.stringify(json).includes('alpha')
  ySyncPluginKey.getState(human.state).binding.unrenderSnapshot()
  await tick(); hub.flush()
  return {
    schema: codeAllowsYChange ? 'codeBlock admits ychange' : 'stock StarterKit (codeBlock marks "")',
    sizes: { v1: v1.length, v2: v2.length },
    score: sc, spans: sp, codeRendered, tableRendered, errors,
    liveUnchangedByHistory: liveBefore === live.toString(),
    exitShowsLive: human.getText().includes('Agent inserted paragraph.') && !human.getText().includes('the middle of')
  }
}

const results = [await run(false), await run(true)]
writeFileSync(new URL('../out/v13-history.json', import.meta.url), JSON.stringify(results, null, 2))
for (const r of results) {
  console.log(`\nv13 state-pair snapshot, ${r.schema}: ${r.score.filter(s => s.ok).length}/${r.score.length}  (code block rendered: ${r.codeRendered}, table rendered: ${r.tableRendered}, live unchanged: ${r.liveUnchangedByHistory}, exit ok: ${r.exitShowsLive})`)
  for (const s of r.score) console.log(`  ${s.ok ? 'ok ' : 'MISS'} ${s.id.padEnd(20)} ${s.got}`)
  if (r.errors.length) console.log('  console.error during render:', JSON.stringify(r.errors))
}
console.log('\nspans (codeBlock admits ychange):'); for (const s of results[1].spans.filter(s => s.kind !== 'none')) console.log(`  ${s.where} ${s.kind} by ${s.who} ${s.node ? '[node] ' + JSON.stringify(s.text.slice(0, 30)) : JSON.stringify(s.text)}`)
process.exit(0)
