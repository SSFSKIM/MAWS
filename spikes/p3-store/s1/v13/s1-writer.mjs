// S1 scenario 5 on Yjs v13 (parity with v14/s1-writer.mjs): markdown → PM → Y.XmlFragment (y-tiptap's
// prosemirrorToYXmlFragment) → PM → markdown with no DOM, and the same agent edits as XmlText/XmlElement ops. Run:
//   node spikes/p3-store/s1/v13/s1-writer.mjs   (writes out/v13-writer.json)
import { writeFileSync } from 'node:fs'
import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as aw from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { UniqueID, generateUniqueIds } from '@tiptap/extension-unique-id'
import { MarkdownManager } from '@tiptap/markdown'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import { createHub } from '../lib/link.mjs'
import { sample } from '../lib/md-sample.mjs'

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
check('no DOM in this process', typeof window === 'undefined' && typeof document === 'undefined')
const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']
let n = 0
const exts = [StarterKit.configure({ undoRedo: false }), Table, TableRow, TableCell, TableHeader, UniqueID.configure({ types: BLOCK_TYPES, generateID: () => 'b' + (++n).toString(36) })]
const schema = getSchema(exts)
const md = new MarkdownManager({ extensions: exts })
const t0 = performance.now()
const pm = schema.nodeFromJSON(generateUniqueIds(md.parse(sample), exts))
const canon = md.serialize(pm.toJSON())
const hostDoc = new Y.Doc()
const hub = createHub({ Y, sync, aw, encoding, decoding, hostDoc })
const host = hostDoc.getXmlFragment('default')
hostDoc.transact(() => prosemirrorToYXmlFragment(pm, host), { actor: 'agent:create' })
const back = yXmlFragmentToProseMirrorRootNode(host, schema)
check('PM → Y → PM equal', back.eq(pm))
check('Y → markdown byte-identical to the canonical markdown', md.serialize(back.toJSON()) === canon)
const msRoundTrip = performance.now() - t0

const agent = new Y.Doc(); hub.connect(agent, 'agent:session-1'); hub.flush()
const root = agent.getXmlFragment('default')
const plain = el => el.toArray().filter(c => c instanceof Y.XmlText).map(t => t.toDelta().map(d => d.insert).join('')).join('')
const txt = el => el.toArray().find(c => c instanceof Y.XmlText)
const top = () => root.toArray()
const closing = top().find(c => c.nodeName === 'paragraph' && plain(c).startsWith('Closing'))
const intro = top().find(c => c.nodeName === 'paragraph' && plain(c).startsWith('Intro'))
const risks = top().find(c => c.nodeName === 'heading' && plain(c) === 'Risks')
agent.transact(() => {
  const t = txt(closing)
  t.insert(plain(closing).indexOf('has'), 'now ')
  const i = plain(closing).indexOf('two'); t.delete(i, 3); t.insert(i, 'three short')
  txt(intro).delete(0, 5); txt(intro).insert(0, 'Opening')
}, { actor: 'agent' })
agent.transact(() => {
  const k = top().indexOf(risks)
  const tmp = new Y.Doc(); const frag = tmp.getXmlFragment('x')
  prosemirrorToYXmlFragment(schema.nodeFromJSON(generateUniqueIds(md.parse('A new paragraph after **Risks**.\n\n- inserted item'), exts)), frag)
  root.insert(k + 1, frag.toArray().map(e => e.clone()))
}, { actor: 'agent' })
const closingId = closing.getAttribute('id')
agent.transact(() => {
  const k = top().indexOf(closing)
  const text = plain(closing)
  root.delete(k, 1)
  const h = new Y.XmlElement('heading'); h.setAttribute('level', 3); h.setAttribute('id', closingId); h.insert(0, [new Y.XmlText(text)])
  root.insert(k, [h])
}, { actor: 'agent' })
hub.flush()
const updateBytes = hub.log.filter(e => e.actor === 'agent:session-1').map(e => e.v2.length)
const outMd = md.serialize(yXmlFragmentToProseMirrorRootNode(host, schema).toJSON())
check('multi-hunk text edit applied', outMd.includes('It now has three short sentences.'))
check('word edit beside marks keeps the marks', outMd.includes('Opening paragraph with **bold**, *italic*, `code` and a [link](https://example.com).'))
check('section inserted after the heading', /## Risks\n\nA new paragraph after \*\*Risks\*\*\.\n\n- inserted item/.test(outMd))
check('type change keeps the block id', host.toArray().some(c => c.nodeName === 'heading' && c.getAttribute('id') === closingId))
writeFileSync(new URL('../out/v13-writer.json', import.meta.url), JSON.stringify({ results, msRoundTrip: Math.round(msRoundTrip), agentUpdateBytesV2: updateBytes, outMd }, null, 2))
console.log(`\n${results.filter(r => r.ok).length}/${results.length} checks passed; agent update sizes (V2 bytes): ${updateBytes.join(', ')}; round trip ${Math.round(msRoundTrip)} ms`)
process.exit(0)
