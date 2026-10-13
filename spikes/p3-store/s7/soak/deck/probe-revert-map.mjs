// S7a probe: a minimal case for the deck restore gap. One map attribute (a slide element's style key) overwritten n
// times after the version, by one or several clients, on a gc-on host doc; then S3's revert of the version. Is the
// attribute back to the version's value? Also a deleted and re-added key, and an element node deleted since.
import * as Y from '@y/y'
import { revertUpdate } from '../doc/restore.mjs'
import { revertUpdateFixed } from '../revert.mjs'

const run = (label, opts) => { for (const [name, fn] of [['S3 revert', revertUpdate], ['fixed', revertUpdateFixed]]) { try { once(label + ' [' + name + ']', opts, fn) } catch (e) { console.log((label + ' [' + name + ']').padEnd(56), 'throws:', e.message) } } }
const once = (label, { n, clients, gc = true, deleteKey = false, deleteNode = false, prevRestore = false }, revert) => {
  const doc = new Y.Doc({ gc })
  doc.clientID = 1
  doc.transact(() => { const el = new Y.Node('el'); doc.get('slides').setAttr('e1', el); el.setAttr('left', 'v0'); el.setAttr('top', 't0') })
  if (prevRestore) { // an older restore already wrote this key once from a scratch client
    const s0 = Y.encodeStateAsUpdateV2(doc)
    doc.clientID = 2; doc.transact(() => doc.get('slides').getAttr('e1').setAttr('left', 'x'))
    Y.applyUpdateV2(doc, revert(s0, Y.encodeStateAsUpdateV2(doc)))
  }
  const version = Y.encodeStateAsUpdateV2(doc)
  for (let k = 1; k <= n; k++) { doc.clientID = 10 + (k % clients); doc.transact(() => doc.get('slides').getAttr('e1').setAttr('left', 'v' + k)) }
  if (deleteKey) { doc.clientID = 99; doc.transact(() => doc.get('slides').getAttr('e1').deleteAttr('left')) }
  if (deleteNode) { doc.clientID = 98; doc.transact(() => doc.get('slides').deleteAttr('e1')) }
  const R = revert(version, Y.encodeStateAsUpdateV2(doc))
  Y.applyUpdateV2(doc, R)
  const el = doc.get('slides').getAttr('e1')
  console.log(label.padEnd(56), JSON.stringify(el ? el.getAttrs() : null))
}
run('1 overwrite', { n: 1, clients: 1 })
run('2 overwrites, one client', { n: 2, clients: 1 })
run('20 overwrites, one client (a drag)', { n: 20, clients: 1 })
run('20 overwrites, one client, gc off', { n: 20, clients: 1, gc: false })
run('5 overwrites, 3 clients', { n: 5, clients: 3 })
run('3 overwrites then key deleted', { n: 3, clients: 2, deleteKey: true })
run('3 overwrites then node deleted', { n: 3, clients: 2, deleteNode: true })
run('after an earlier restore, 3 overwrites', { n: 3, clients: 2, prevRestore: true })
