// S1 probe: does a remote node-attribute change (the host's id repair) make the live (renderer-less) v14 binding
// warn about "y-attributed-attrs", and does it depend on that mark being in the schema? Also: does it write back?
//   node spikes/p3-store/s1/v14/probe-attrs-warning.mjs
import { tick } from '../lib/dom.mjs'
import * as Y from '@y/y'
import { Editor } from '@tiptap/core'
import { pmnodeToDelta } from '@y/prosemirror'
import { extensions, schemaFor } from './schema.mjs'
import { YCollaboration } from './collab.mjs'

const warns = []
const ow = console.warn
console.warn = (...a) => { warns.push(String(a[0]).slice(0, 90)); }
for (const withAttrsMark of [true]) {
  warns.length = 0
  const exts = extensions().filter(e => withAttrsMark || e.name !== 'y-attributed-attrs')
  const schema = schemaFor()
  const doc = new Y.Doc()
  const t = doc.get('default')
  t.applyDelta(pmnodeToDelta(schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Hi' }] }, { type: 'heading', attrs: { id: 'h1', level: 2 }, content: [{ type: 'text', text: 'H' }] }] })))
  const el = document.createElement('div'); document.body.appendChild(el)
  const ed = new Editor({ element: el, extensions: [...exts, YCollaboration.configure({ ytype: t })] })
  await tick()
  const remote = new Y.Doc(); Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
  const back = []
  doc.on('update', (u, origin) => { if (origin !== 'remote') back.push(u.length) })
  remote.on('update', u => Y.applyUpdate(doc, u, 'remote'))
  remote.get('default').get(0).setAttr('id', 'p1-new')
  await tick()
  remote.get('default').get(1).setAttr('level', 3)
  await tick()
  console.log(`attrs mark in schema=${withAttrsMark}: editor ids/level ${JSON.stringify(ed.getJSON().content.map(n => [n.attrs.id, n.attrs.level]))}; warnings ${JSON.stringify(warns)}; editor wrote back ${back.length} update(s)`)
  ed.destroy()
}
console.warn = ow
process.exit(0)
