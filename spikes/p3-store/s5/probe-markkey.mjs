// S5 probe: what `excludes: ''` means for the comment mark's storage key on v14 — the key is
// `comment--<hash of mark.toJSON()>`, so every attribute (with its default) is part of the identity. What happens when
// an attribute changes (BlockNote's orphan flag) or the schema adds one later (an editor with a newer comment mark bound
// to a document written by the older one). Run: node spikes/p3-store/s5/probe-markkey.mjs   (writes out/markkey.txt)
import { tick } from './lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import { Editor, Mark, getSchema } from '@tiptap/core'
import { pmnodeToDelta } from '@y/prosemirror'
import { extensions } from './lib/schema.mjs'
import { YCollaboration } from './lib/collab.mjs'
import { Comment } from './lib/comments.mjs'

const lines = []; const log = s => { lines.push(s); console.log(s) }
const keysOf = d => [...new Set((JSON.stringify(d).match(/comment--[A-Za-z0-9+/=]{8}/g) ?? []))]
const s1 = getSchema(extensions())
const CommentV2 = Comment.extend({ addAttributes () { return { ...this.parent?.(), kind: { default: 'note' } } } })
const exts2 = extensions().map(e => (e.name === 'comment' ? CommentV2 : e))
const s2 = getSchema(exts2)
const para = (s, attrs) => s.nodes.paragraph.create({ id: 'p1' }, [s.text('one '), s.text('two', [s.marks.comment.create(attrs)]), s.text(' three')])
log(`same threadId, schema 1: ${keysOf(pmnodeToDelta(para(s1, { threadId: 't1' })).toJSON())}`)
log(`same threadId, orphan:true: ${keysOf(pmnodeToDelta(para(s1, { threadId: 't1', orphan: true })).toJSON())}`)
log(`same threadId, schema 2 (an added attribute with a default): ${keysOf(pmnodeToDelta(para(s2, { threadId: 't1' })).toJSON())}`)

// an editor on schema 2 bound to a document written by schema 1
const doc = new Y.Doc()
doc.get('default').applyDelta(pmnodeToDelta(s1.nodes.doc.create(null, [para(s1, { threadId: 't1' })])))
const writes = []
doc.on('update', (u, origin) => writes.push(u.length))
const el = document.createElement('div'); document.body.appendChild(el)
const ed = new Editor({ element: el, extensions: [...exts2, YCollaboration.configure({ ytype: doc.get('default') })] })
await tick(20)
log(`bind schema-2 editor to a schema-1 doc: ${writes.length} write(s) on bind; editor marks ${JSON.stringify(ed.state.doc.firstChild.child(1).marks.map(m => m.attrs))}; Y keys after bind ${JSON.stringify(keysOf(doc.get('default').toArray()[0].toDelta().toJSON()))}`)
{
  // an older client (schema 1) opening the re-keyed document: does it write back its own key?
  const d2 = new Y.Doc(); Y.applyUpdate(d2, Y.encodeStateAsUpdate(doc))
  const w2 = []; d2.on('update', u => w2.push(u.length))
  const el2 = document.createElement('div'); document.body.appendChild(el2)
  const old = new Editor({ element: el2, extensions: [...extensions(), YCollaboration.configure({ ytype: d2.get('default') })] })
  await tick(20)
  log(`an old-schema editor on the re-keyed doc: ${w2.length} write(s) on bind; Y keys ${JSON.stringify(keysOf(d2.get('default').toArray()[0].toDelta().toJSON()))} (two versions would re-key each other)`)
  old.destroy()
}
const before = writes.length
ed.commands.setTextSelection(6); ed.view.dispatch(ed.state.tr.insertText('X'))
await tick(20)
log(`type inside the old mark: ${writes.length - before} write(s); Y keys now ${JSON.stringify(keysOf(doc.get('default').toDelta().toJSON()))}`)
log(`Y delta: ${JSON.stringify(doc.get('default').toArray()[0].toDelta().toJSON().children)}`)
let n = 0; ed.state.doc.descendants(x => { if (x.isText) n += x.marks.filter(m => m.type.name === 'comment').length })
log(`editor: ${n} comment mark instance(s) across text nodes ${JSON.stringify(ed.state.doc.firstChild.content.toJSON().map(t => [t.text, (t.marks ?? []).length]))}`)
writeFileSync(new URL('./out/markkey.txt', import.meta.url), lines.join('\n') + '\n')
process.exit(0)
