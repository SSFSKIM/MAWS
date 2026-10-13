// S3 probe: what does lib0 delta.diff produce for a YNode attr that holds a YNode, deleted since?
import * as Y from '@y/y'
import * as delta from 'lib0/delta'
const a = new Y.Doc()
a.transact(() => { const s = new Y.Node('slide'); a.get('slides').setAttr('s1', s); s.setAttr('order', 'a1'); const n = new Y.Node('notes'); s.setAttr('notes', n); n.insert(0, 'hello') })
const old = Y.encodeStateAsUpdateV2(a)
a.transact(() => a.get('slides').deleteAttr('s1'))
const dOld = (() => { const d = new Y.Doc(); Y.applyUpdateV2(d, old); return d })()
const dl = delta.diff(a.get('slides').toDeltaDeep(), dOld.get('slides').toDeltaDeep())
console.log('diff json', JSON.stringify(dl.toJSON()))
for (const op of dl.attrs) console.log('op', op.constructor.name, delta.$setAttrOp.check(op), op.key, op.value?.constructor?.name, delta.$deltaAny.check(op.value))
