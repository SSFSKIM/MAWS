// S1 scenario 5 on Yjs v14: the Node writer with no DOM. markdown → ProseMirror (@tiptap/markdown) → Y
// (pmnodeToDelta + YNode.applyDelta) → ProseMirror (ynodeToPmnode) → markdown; then an agent replica edits one block
// as Y operations (multi-hunk text ops keeping marks, an insert after a heading, a type change keeping the id) and the
// host renders the result back to markdown. Run:
//   node spikes/p3-store/s1/v14/s1-writer.mjs   (writes out/v14-writer.json)
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import * as sync from '@y/protocols/sync'
import * as aw from '@y/protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { MarkdownManager } from '@tiptap/markdown'
import { generateUniqueIds } from '@tiptap/extension-unique-id'
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror'
import { extensions, schemaFor } from './schema.mjs'
import { createHub } from '../lib/link.mjs'
import { sample } from '../lib/md-sample.mjs'

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
check('no DOM in this process', typeof window === 'undefined' && typeof document === 'undefined')
let n = 0
const exts = extensions({ generateID: () => 'b' + (++n).toString(36) })
const schema = schemaFor({ generateID: () => 'x' })
const md = new MarkdownManager({ extensions: exts })

const t0 = performance.now()
const json = generateUniqueIds(md.parse(sample), exts)
const pm = schema.nodeFromJSON(json)
// @tiptap/markdown pads GFM tables and adds blank lines around them, so the canonical form is serialize(parse(x));
// check that it is a fixed point and that everything except the table's whitespace is byte-identical
const canon = md.serialize(pm.toJSON())
const squash = s => s.replace(/\n{3,}/g, '\n\n').replace(/ *\| */g, '|').replace(/-{3,}/g, '---').trim()
check('markdown → PM → markdown identical up to table padding', squash(canon) === squash(sample), squash(canon) === squash(sample) ? '' : '\n' + canon)
check('canonical markdown is a fixed point', md.serialize(schema.nodeFromJSON(md.parse(canon)).toJSON()) === canon)

const hostDoc = new Y.Doc()
const hub = createHub({ Y, sync, aw, encoding, decoding, hostDoc })
const host = hostDoc.get('default')
hostDoc.transact(() => host.applyDelta(pmnodeToDelta(pm)), { actor: 'agent:create' })
const back = ynodeToPmnode(host, schema)
check('PM → Y → PM equal (pmnodeToDelta / ynodeToPmnode)', back.eq(pm))
check('Y → markdown byte-identical to the canonical markdown', md.serialize(back.toJSON()) === canon)
const msRoundTrip = performance.now() - t0
const ids = host.toArray().map(c => `${c.name}#${c.getAttr('id')}`)
console.log('top-level blocks:', ids.join(' '))
check('every block carries an id (tables to cell paragraphs)', !/"id":null/.test(JSON.stringify(back.toJSON())))

// ── the agent's replica edits by block id, as Y ops ──
const agent = new Y.Doc(); hub.connect(agent, 'agent:session-1'); hub.flush()
const root = agent.get('default')
const top = () => root.toArray()
const byId = id => top().find(c => c.getAttr('id') === id)
const plain = node => node.toDelta().children.map(op => (typeof op.insert === 'string' ? op.insert : '￼')).join('')
const closing = top().find(c => c.name === 'paragraph' && plain(c).startsWith('Closing'))
const intro = top().find(c => c.name === 'paragraph' && plain(c).startsWith('Intro'))
const risks = top().find(c => c.name === 'heading' && plain(c) === 'Risks')
const before = Y.encodeStateVector(hostDoc)
agent.transact(() => {
  // multi-hunk text edit in one block: "It has two sentences." → "It now has three short sentences."
  const t = plain(closing)
  closing.insert(t.indexOf('has'), 'now ')
  const i = plain(closing).indexOf('two'); closing.delete(i, 3); closing.insert(i, 'three short')
  // a word edit next to marks: "Intro" → "Opening"; bold/italic/code/link elsewhere in the block stay
  intro.delete(0, 5); intro.insert(0, 'Opening')
}, { actor: 'agent' })
agent.transact(() => {
  // insert a section after the "Risks" heading, from markdown, with ids
  const k = top().indexOf(risks)
  const blocks = schema.nodeFromJSON(generateUniqueIds(md.parse('A new paragraph after **Risks**.\n\n- inserted item'), exts)).content
  const deltas = []; blocks.forEach(b => deltas.push(pmnodeToDelta(b)))
  root.insert(k + 1, deltas)
}, { actor: 'agent' })
const closingId = closing.getAttr('id')
agent.transact(() => {
  // a type change keeps the id: a YNode's name is immutable, so delete + insert the new node under the same id
  const k = top().indexOf(byId(closingId))
  const text = plain(byId(closingId))
  root.delete(k, 1)
  root.insert(k, [pmnodeToDelta(schema.nodes.heading.create({ level: 3, id: closingId }, schema.text(text)))])
}, { actor: 'agent' })
hub.flush()
const updateBytes = hub.log.filter(e => e.actor === 'agent:session-1').map(e => e.v2.length)
const outMd = md.serialize(ynodeToPmnode(host, schema).toJSON())
console.log('\nhost after the agent\'s edits, as markdown:\n' + outMd)
check('multi-hunk text edit applied', outMd.includes('It now has three short sentences.'))
check('word edit beside marks keeps the marks', outMd.includes('Opening paragraph with **bold**, *italic*, `code` and a [link](https://example.com).'))
check('section inserted after the heading', /## Risks\n\nA new paragraph after \*\*Risks\*\*\.\n\n- inserted item/.test(outMd))
check('type change keeps the block id', host.toArray().some(c => c.name === 'heading' && c.getAttr('id') === closingId && c.getAttr('level') === 3))
const intro2 = host.toArray().find(c => c.getAttr('id') === intro.getAttr('id'))
console.log('intro block as a v14 delta (the XmlText delta API is gone; text is inline in the YNode):', JSON.stringify(intro2.toDelta().toJSON()).slice(0, 400))

writeFileSync(new URL('../out/v14-writer.json', import.meta.url), JSON.stringify({ results, msRoundTrip: Math.round(msRoundTrip), agentUpdateBytesV2: updateBytes, outMd }, null, 2))
console.log(`\n${results.filter(r => r.ok).length}/${results.length} checks passed; agent update sizes (V2 bytes): ${updateBytes.join(', ')}; round trip ${Math.round(msRoundTrip)} ms`)
process.exit(0)
