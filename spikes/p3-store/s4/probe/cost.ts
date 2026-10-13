// S4 probe: where a batch's time goes on the mid-sized document (whole-document strict validation vs the rest).
import * as Y from '@y/y'
import { world } from '../test/setup.ts'
const { host, agent } = world(40)
const a = agent('agent:s1')
const w = (host as any).writerFor('agent:s1')
const root = a.doc.get('default')
const t = (f: () => void, n = 20) => { const t0 = performance.now(); for (let i = 0; i < n; i++) f(); return Math.round((performance.now() - t0) / n * 100) / 100 }
console.log('strict validation of the whole root:', t(() => w.strict(root)), 'ms')
console.log('clone (encode + apply V2):', t(() => { const c = new Y.Doc(); Y.applyUpdateV2(c, Y.encodeStateAsUpdateV2(a.doc)) }), 'ms')
console.log('find a block by id (DFS):', t(() => w.find(root, 'ps391')), 'ms')
console.log('run without the dry run (one replace_text in a transaction):', t(() => a.doc.transact(() => w.run(a.doc, [{ op: 'replace_text', block: 'ps201', old: 'Closing', new: 'Closing' }], new Set()))), 'ms')
process.exit(0)
