// S4 probe: debug the retype path on a bare doc (no host), with and without the dry run.
import * as Y from '@y/y'
import { PatchWriter } from '../src/patch-writer.ts'
import { schema, md, marksOf } from '../test/setup.ts'
import { load } from '../src/fixture.ts'
const w = new PatchWriter({ schema, md })
for (const dry of [false, true]) {
  const src = new Y.Doc(); load(src, schema)
  const doc = new Y.Doc(); Y.applyUpdateV2(doc, Y.encodeStateAsUpdateV2(src))
  const ops = [{ op: 'replace_block', id: 'p1', markdown: '## The quick brown fox jumps over the lazy [dog](https://example.com).' }] as any
  if (dry) w.apply(doc, ops); else doc.transact(() => w.run(doc, ops, new Set()))
  console.log(dry ? 'apply' : 'run  ', marksOf(doc, 'p1'))
}
const doc = new Y.Doc(); load(doc, schema)
const root: any = doc.get('default')
doc.transact(() => {
  const old = root.get(1)
  root.delete(1, 1)
  console.log('get(1) after delete is', root.get(1).getAttr('id'))
  root.insert(1, [old.toDeltaDeep ? { } : {}].length ? [] : [])
})
process.exit(0)
