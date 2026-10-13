// The text fragment is y-prosemirror's shape, so a Tiptap/ProseMirror instance binds to it: y-prosemirror reads what
// the model writes into a valid document of the slide-text schema (Claude's inline set, no wider), and what
// y-prosemirror writes, the model reads back identically. Then a live binding: ySyncPlugin on one replica's fragment,
// an edit typed through ProseMirror, the other replica reads it.
// the shared package's @tiptap/pm (the prosemirror copy its y-prosemirror 1.3.7 uses); s6's own @tiptap/pm serves the v14 stack
import { Schema, type NodeSpec } from '../../node_modules/@tiptap/pm/dist/model/index.js'
import { EditorState } from '../../node_modules/@tiptap/pm/dist/state/index.js'
import * as YJS from 'yjs'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode, ySyncPlugin, ySyncPluginKey } from 'y-prosemirror'
import { Window } from 'happy-dom'
import { publish } from '../src/publish.ts'
import { readFlat } from '../src/model.ts'
import * as Y from '../src/ydoc.ts'
import { Report } from './lib.ts'

if (process.env.S6_YJS !== '13') throw new Error('exp/binding.ts is the v13 check: run it with --import ./exp/use-v13.mjs (v14: exp/binding-v14.ts)')
const r = new Report('binding')
/** The slide-text schema: a text box's lines are `p` (h1-h3/p/th/td) or `li` (ul/ol) blocks; inline: text, br; marks a, span, b, i, u. */
const slideText = (block: 'p' | 'li') => new Schema({
  nodes: {
    doc: { content: block === 'p' ? 'p' : 'li+' },
    [block]: { content: 'inline*', toDOM: () => [block, 0] } as NodeSpec,
    text: { group: 'inline' },
    br: { group: 'inline', inline: true, toDOM: () => ['br'] },
  },
  marks: {
    a: { attrs: { href: {} }, inclusive: false, toDOM: (m) => ['a', { href: m.attrs.href }, 0] },
    span: { attrs: { color: {} }, toDOM: (m) => ['span', { style: `color:${m.attrs.color}` }, 0] },
    b: { toDOM: () => ['b', 0] }, i: { toDOM: () => ['i', 0] }, u: { toDOM: () => ['u', 0] },
  },
})

const doc = Y.newDoc(1)
publish(doc, { 'project/slides/s.html': `<section id="s">
<p id="t">Plain <b>bold <i>both</i></b> <a href="https://x.dev">link</a><br><span style="color:#c00">red</span> <u>u</u></p>
<ul id="l"><li>one</li><li><b>two</b> three</li></ul></section>` })
const elMap = (doc_: unknown, id: string) => (((doc_ as YJS.Doc).getMap('slides').get('s') as YJS.Map<unknown>).get('elements') as YJS.Map<YJS.Map<unknown>>).get(id)!
const frag = (id: string) => elMap(doc, id).get('text') as YJS.XmlFragment

for (const [id, block] of [['t', 'p'], ['l', 'li']] as const) {
  const schema = slideText(block)
  let ok = true, json: unknown
  try { const pm = yXmlFragmentToProseMirrorRootNode(frag(id), schema); pm.check(); json = pm.toJSON() } catch (e) { ok = false; json = String(e) }
  r.check(`y-prosemirror reads the model's fragment for <${id === 't' ? 'p' : 'ul'}> into a valid slide-text document`, ok, json)
  // the other direction: y-prosemirror writes the document, the model reads it identically
  const d2 = new YJS.Doc(); const f2 = d2.getXmlFragment('x')
  prosemirrorJSONToYXmlFragment(schema, json, f2)
  const host = Y.newDoc(2)
  publish(host, { 'project/slides/s.html': '<section id="s"><p id="t">x</p><ul id="l"><li>x</li></ul></section>' })
  const el = elMap(host, id)
  host.transact(() => { const f3 = new YJS.XmlFragment(); el.set('text', f3); f3.insert(0, f2.toArray().map((c) => c.clone() as YJS.XmlElement)) })
  r.check(`… and what y-prosemirror writes, the model reads back identically (<${id === 't' ? 'p' : 'ul'}>)`, JSON.stringify(Y.readText(host, 's', id)) === JSON.stringify(Y.readText(doc, 's', id)), Y.readText(host, 's', id))
}

// a live binding: ProseMirror with ySyncPlugin on replica B's fragment types a word; replica A reads it
{
  const win = new Window(); Object.assign(globalThis, { window: win, document: win.document })
  const { EditorView } = await import('../../node_modules/@tiptap/pm/dist/view/index.js')
  const B = Y.newDoc(3); Y.pull(B, doc)
  const fragB = elMap(B, 't').get('text') as YJS.XmlFragment
  const schema = slideText('p')
  const view = new EditorView(win.document.createElement('div') as unknown as HTMLElement, { state: EditorState.create({ schema, plugins: [ySyncPlugin(fragB)] }) })
  await new Promise((res) => setTimeout(res, 0))
  view.dispatch(view.state.tr.insertText('Very ', 1)) // type at the start of the paragraph
  Y.pull(doc, B)
  const t = Y.readText(doc, 's', 't')[0].inline
  r.check('a ProseMirror edit through ySyncPlugin on replica B reaches replica A through the model\'s reader', 'text' in t[0] && t[0].text === 'Very Plain ', t[0])
  r.check('the binding kept the marks and the <br> (the readers agree on the shape)', readFlat(doc, 's').find((e) => e.id === 't')!.text![0].inline.some((x) => 'br' in x), Y.readText(doc, 's', 't'))
  r.check('the binding wrote no ychange or foreign attributes the model would drop', !JSON.stringify((frag('t').toJSON())).includes('ychange'))
  view.destroy(); void ySyncPluginKey
}
r.write()
