// S2 v14 probe 2: a same-client gap on another root (v14 integrates it behind a Skip, leaving a hole), a parent-
// missing gap (parked), and 2,000 mutated valid updates applied with no check: how often v14 parks state or leaves a
// hole, and whether S2's checkV1 refuses every such update. Prints lines of JSON.
import * as Y from '@y/y';
import { checkV1, hasPending } from '../v14/yjs';

const st = (d: Y.Doc) => ({ pendingStructs: d.store.pendingStructs !== null, pendingDs: d.store.pendingDs !== null, skips: !d.store.skips.isEmpty(), sv: [...Y.decodeStateVector(Y.encodeStateVector(d))].map(([, k]) => k) });
const structs = (u: Uint8Array) => Y.decodeUpdate(u).structs.map((s) => `${s.constructor.name}:${s.id.clock}+${s.length}`);

{
  const w = new Y.Doc();
  w.get('x').insert(0, 'abc');
  const sv = Y.encodeStateVector(w);
  w.get('y').insert(0, 'def');
  const g = new Y.Doc();
  const ev: Uint8Array[] = [];
  g.on('update', (u: Uint8Array) => ev.push(u));
  Y.applyUpdate(g, Y.encodeStateAsUpdate(w, sv));
  console.log('pure gap', JSON.stringify({ state: st(g), y: g.get('y').toString(), events: ev.map(structs) }));
  const n = new Y.Doc();
  Y.applyUpdate(n, Y.encodeStateAsUpdate(g));
  console.log('newcomer synced from the holey doc', JSON.stringify({ state: st(n), y: n.get('y').toString() }));
}
{
  const w = new Y.Doc();
  const p = new Y.Node('paragraph');
  w.get('content').push([p]);
  p.insert(0, 'abc');
  const s1 = Y.encodeStateVector(w);
  p.insert(3, 'def');
  const g = new Y.Doc();
  const ev: Uint8Array[] = [];
  g.on('update', (u: Uint8Array) => ev.push(u));
  Y.applyUpdate(g, Y.encodeStateAsUpdate(w, s1));
  console.log('parent-missing gap', JSON.stringify({ state: st(g), events: ev.map(structs) }));
}
{
  const base = new Y.Doc();
  const t = base.get('t');
  for (let i = 0; i < 40; i++) t.insert(t.length, `w${i} `);
  const sv = Y.encodeStateVector(base);
  const editor = new Y.Doc();
  Y.applyUpdate(editor, Y.encodeStateAsUpdate(base));
  editor.get('t').insert(5, 'XYZ');
  editor.get('t').delete(20, 4);
  const valid = Y.encodeStateAsUpdate(editor, sv);
  const tally = { threw: 0, parkedOrHole: 0, clean: 0, checkRefused: 0, checkPassedButParked: 0 };
  for (let i = 0; i < 2000; i++) {
    const m = valid.slice();
    const k = 1 + Math.floor(Math.random() * 3);
    for (let j = 0; j < k; j++) m[Math.floor(Math.random() * m.length)] = Math.floor(Math.random() * 256);
    const d = new Y.Doc();
    Y.applyUpdate(d, Y.encodeStateAsUpdate(base));
    const refused = checkV1(d, m) !== null;
    if (refused) tally.checkRefused += 1;
    try {
      Y.applyUpdate(d, m);
    } catch {
      tally.threw += 1;
      continue;
    }
    if (hasPending(d)) {
      tally.parkedOrHole += 1;
      if (!refused) tally.checkPassedButParked += 1;
    } else tally.clean += 1;
  }
  console.log('2000 mutated updates applied with no check', JSON.stringify(tally));
}
