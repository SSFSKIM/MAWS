// S7a probe: the restore gap on a document. A task item's `checked` toggled twice and a heading's `level` changed twice
// since the version (block attributes are YNode attributes, like a slide element's style keys); then S3's revert and the
// fixed one. Is the version's value back?
import * as Y from '@y/y'
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror'
import { schemaFor } from './schema.mjs'
import { revertUpdate } from './restore.mjs'
import { revertUpdateFixed } from '../revert.mjs'

const schema = schemaFor({ uniqueId: false })
const json = { type: 'doc', content: [
  { type: 'heading', attrs: { id: 'h', level: 2 }, content: [{ type: 'text', text: 'Title' }] },
  { type: 'taskList', attrs: { id: 'tl' }, content: [{ type: 'taskItem', attrs: { id: 'ti', checked: false }, content: [{ type: 'paragraph', attrs: { id: 'tp' }, content: [{ type: 'text', text: 'Ship it' }] }] }] }] }
for (const [name, revert] of [['S3 revertUpdate', revertUpdate], ['revertUpdateFixed', revertUpdateFixed]]) {
  for (const times of [1, 2]) {
    const doc = new Y.Doc({ gc: true }); doc.clientID = 1
    doc.transact(() => doc.get('body').applyDelta(pmnodeToDelta(schema.nodeFromJSON(json))))
    const version = Y.encodeStateAsUpdateV2(doc)
    const body = doc.get('body'); const [h, tl] = body.toArray(); const ti = tl.toArray()[0]
    for (let k = 1; k <= times; k++) { doc.clientID = 10 + k; doc.transact(() => { ti.setAttr('checked', k % 2 === 1); h.setAttr('level', k % 2 === 1 ? 3 : 1) }) }
    Y.applyUpdateV2(doc, revert(version, Y.encodeStateAsUpdateV2(doc)))
    const pm = ynodeToPmnode(doc.get('body'), schema).toJSON()
    console.log(`${name}, changed ${times}x since the version: heading level ${pm.content[0].attrs.level} (want 2), task checked ${pm.content[1].content[0].attrs.checked} (want false)`)
  }
}
