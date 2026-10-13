// The text <doc> node is @y/prosemirror 2's shape, so a Tiptap text box binds to it on v14: ynodeToPmnode reads what the
// model writes into a valid slide-text document (Claude's inline set, no wider); what pmnodeToDelta writes the model
// reads back identically; then a live Tiptap 3.31.3 editor bound through S1's YCollaboration (copied: exp/collab-v14.mjs)
// on one replica types, and the other replica reads it through the model; a model write reaches the editor.
import '../../s1/lib/dom.mjs' // S1's happy-dom globals (read-only import), before any Tiptap module
import { Editor, Mark, Node } from '@tiptap/core'
import * as Y from '@y/y'
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror'
// @ts-expect-error S1's untyped module (copied)
import { YCollaboration } from './collab-v14.mjs'
import { publish } from '../src/publish.ts'
import * as M from '../src/ydoc.ts'
import { Report } from './lib.ts'

const r = new Report('binding')
/** The slide-text schema as Tiptap extensions: a text box's lines are `p` (h1-h3/p/th/td) or `li` (ul/ol) blocks; inline text and `br`; marks a, span, b, i, u. */
const slideText = (block: 'p' | 'li') => [
  Node.create({ name: 'doc', topNode: true, content: block === 'p' ? 'p' : 'li+' }),
  Node.create({ name: block, content: 'inline*', parseHTML: () => [{ tag: block }], renderHTML: () => [block, 0] }),
  Node.create({ name: 'text', group: 'inline' }),
  Node.create({ name: 'br', group: 'inline', inline: true, parseHTML: () => [{ tag: 'br' }], renderHTML: () => ['br'] }),
  Mark.create({ name: 'a', inclusive: false, addAttributes: () => ({ href: { default: null } }), parseHTML: () => [{ tag: 'a[href]' }], renderHTML: ({ HTMLAttributes }) => ['a', HTMLAttributes, 0] }),
  Mark.create({ name: 'span', addAttributes: () => ({ color: { default: null } }), parseHTML: () => [{ tag: 'span' }], renderHTML: ({ mark }) => ['span', { style: `color:${mark.attrs.color}` }, 0] }),
  Mark.create({ name: 'b', parseHTML: () => [{ tag: 'b' }], renderHTML: () => ['b', 0] }),
  Mark.create({ name: 'i', parseHTML: () => [{ tag: 'i' }], renderHTML: () => ['i', 0] }),
  Mark.create({ name: 'u', parseHTML: () => [{ tag: 'u' }], renderHTML: () => ['u', 0] }),
]
const schemaOf = (block: 'p' | 'li') => { const e = new Editor({ extensions: slideText(block) }); const s = e.schema; e.destroy(); return s }

const doc = M.newDoc(1)
publish(doc, { 'project/slides/s.html': `<section id="s">
<p id="t">Plain <b>bold <i>both</i></b> <a href="https://x.dev">link</a><br><span style="color:#c00">red</span> <u>u</u></p>
<ul id="l"><li>one</li><li><b>two</b> three</li></ul></section>` })
const textNode = (d: Y.Doc, id: string) => (((d.get('slides').getAttr('s') as Y.Node).getAttr('elements') as Y.Node).getAttr(id) as Y.Node).getAttr('text') as Y.Node

for (const [id, block] of [['t', 'p'], ['l', 'li']] as const) {
  const schema = schemaOf(block)
  let ok = true, json: unknown, pm: ReturnType<typeof ynodeToPmnode> | undefined
  try { pm = ynodeToPmnode(textNode(doc, id), schema); pm.check(); json = pm.toJSON() } catch (e) { ok = false; json = String(e) }
  r.check(`@y/prosemirror 2 reads the model's <doc> for <${id === 't' ? 'p' : 'ul'}> into a valid slide-text document`, ok, json)
  if (!pm) continue
  // the other direction: @y/prosemirror writes the document, the model reads it identically
  const host = M.newDoc(2)
  publish(host, { 'project/slides/s.html': '<section id="s"><p id="t">x</p><ul id="l"><li>x</li></ul></section>' })
  const el = ((host.get('slides').getAttr('s') as Y.Node).getAttr('elements') as Y.Node).getAttr(id) as Y.Node
  host.transact(() => { const f = new Y.Node('doc'); el.setAttr('text', f as never); f.applyDelta(pmnodeToDelta(pm!) as never) })
  r.check(`… and what pmnodeToDelta writes, the model reads back identically (<${id === 't' ? 'p' : 'ul'}>)`,
    JSON.stringify(M.readText(host, 's', id)) === JSON.stringify(M.readText(doc, 's', id)), M.readText(host, 's', id))
}

// a live binding: Tiptap + YCollaboration on replica B's <doc> node; typing on B reaches A; a model write on A reaches B's editor
{
  const B = M.newDoc(3); M.pull(B, doc)
  const el = document.createElement('div'); document.body.appendChild(el)
  let updates = 0; const off = M.onUpdate(B, () => { updates++ })
  const editor = new Editor({ element: el, extensions: [...slideText('p'), YCollaboration.configure({ ytype: textNode(B, 't') })] })
  await new Promise((res) => setTimeout(res, 10))
  r.check('the bound editor holds exactly the document @y/prosemirror reads from the model', JSON.stringify(editor.getJSON()) === JSON.stringify(ynodeToPmnode(textNode(B, 't'), editor.schema).toJSON()), editor.getHTML())
  r.check('binding wrote nothing to the model on bind (no normalization update)', updates === 0, updates); off()
  editor.commands.insertContentAt(1, 'Very ')
  await new Promise((res) => setTimeout(res, 10))
  M.pull(doc, B)
  const t = M.readText(doc, 's', 't')[0].inline
  r.check('a Tiptap edit on replica B reaches replica A through the model\'s reader', 'text' in t[0] && t[0].text === 'Very Plain ', t[0])
  r.check('… with the marks and the <br> intact', JSON.stringify(t).includes('"br":true') && JSON.stringify(t).includes('"a":{"href":"https://x.dev"}'), M.readText(doc, 's', 't'))
  // a model write (as an agent publish would) on A reaches B's editor
  M.transact(doc, () => M.patchText(doc, 's', 't', [{ type: 'p', inline: [{ text: 'Very Plain ', marks: {} }, { text: 'bold', marks: { b: {} } }] }]))
  M.pull(B, doc)
  await new Promise((res) => setTimeout(res, 10))
  r.check('a model patch on A (agent publish) reaches B\'s editor', editor.getHTML() === '<p>Very Plain <b>bold</b></p>', editor.getHTML())
  const attrs = JSON.stringify((textNode(doc, 't').get(0) as Y.Node).toDelta().toJSON())
  r.check('the binding stored marks under their plain names (no name--<hash> keys, no y-attributed-*)', !/--|y-attributed/.test(attrs), attrs.slice(0, 300))
  editor.destroy()
}
r.write()
process.exit(process.exitCode ?? 0)
