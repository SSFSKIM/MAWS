// S4 probe: formatting a node inserted earlier in the same transaction (v14).
import * as Y from '@y/y'
import * as delta from 'lib0/delta'
import { pmnodeToDelta } from '@y/prosemirror'
import { schemaFor } from '../src/schema.ts'
const schema = schemaFor({ generateID: () => 'x' })
const para = schema.nodes.heading.create({ id: 'p1', level: 2 }, [schema.text('The quick brown fox')])
for (const mode of ['same-tx', 'next-tx', 'format()']) {
  const yd = new Y.Doc(); const root: any = yd.get('default')
  const f = (n: any) => {
    if (mode === 'format()') n.format(4, 6, { 'comment--abc': { threadId: 't1' } })
    else n.applyDelta(delta.create().retain(4).retain(6, { 'comment--abc': { threadId: 't1' } }).retain(9).done())
  }
  if (mode === 'next-tx') { yd.transact(() => root.insert(0, [pmnodeToDelta(para)])); yd.transact(() => f(root.get(0))) } else yd.transact(() => { root.insert(0, [pmnodeToDelta(para)]); f(root.get(0)) })
  console.log(mode.padEnd(10), JSON.stringify(root.get(0).toDelta().toJSON().children))
}
process.exit(0)
