// S4 probe: how v14 stores a paragraph with marks and overlapping comments, what observeDeep reports, item ids.
import * as Y from '@y/y'
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror'
import { schemaFor } from '../src/schema.ts'
const schema = schemaFor({ generateID: () => 'x' })
const c1 = schema.marks.comment.create({ threadId: 't1' }), c2 = schema.marks.comment.create({ threadId: 't2' })
const p = schema.nodes.paragraph.create({ id: 'p1' }, [schema.text('Hello '), schema.text('bold', [schema.marks.bold.create(), c1]), schema.text(' world', [c1, c2]), schema.text(' end')])
const doc = schema.nodes.doc.create(null, [p, schema.nodes.heading.create({ id: 'h1', level: 2 }, schema.text('Head'))])
const yd = new Y.Doc(); const root: any = yd.get('default')
root.applyDelta(pmnodeToDelta(doc))
const yp = root.get(0)
console.log('name', yp.name, 'len', yp.length, 'id', yp.getAttr('id'), 'attrs', JSON.stringify(yp.getAttrs()))
console.log('delta', JSON.stringify(yp.toDelta().toJSON()))
console.log('children ops', [...yp.toDelta().children].map((o: any) => JSON.stringify({ insert: o.insert, format: o.format, type: o.type })).join('\n'))
console.log('parent of yp is root', yp.parent === root, 'item id', yp._item.id)
yd.on("afterTransaction", (tr: any) => { for (const [t, subs] of tr.changed) console.log("changed", t.name, t.getAttr?.("id"), [...subs]) })
yd.transact(() => { yp.insert(2, 'XX'); yp.format(0, 1, { bold: {} }) })
yd.transact(() => { root.get(1).setAttr('level', 3) })
console.log('pm back', JSON.stringify(ynodeToPmnode(yp, schema).toJSON()))
console.log('toString', root.toString())
console.log('root children', root.toArray().map((c: any) => c.name))
