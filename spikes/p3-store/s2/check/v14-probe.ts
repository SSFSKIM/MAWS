// S2 v14 probe: what @y/y 14.0.0-rc.28 does with the update shapes the host must refuse (a gap, a missing origin, a
// deletion of an unknown clock), and the YNode / ContentMap calls the port uses. Prints one JSON summary.
import * as Y from '@y/y';

const out: Record<string, unknown> = {};
const state = (d: Y.Doc) => ({
  pendingStructs: d.store.pendingStructs !== null,
  pendingDs: d.store.pendingDs !== null,
  skips: !d.store.skips.isEmpty(),
  sv: [...Y.decodeStateVector(Y.encodeStateVector(d))],
});

// the document model: a root node of paragraph nodes holding text directly
const a = new Y.Doc();
const root = a.get('content');
const p = new Y.Node('paragraph');
root.push([p]);
p.insert(0, 'hello world');
out.model = { rootString: root.toString(), length: p.length, child: root.get(0) === p, delta: JSON.stringify(p.toDelta()).slice(0, 200) };
const rel = Y.createRelativePositionFromTypeIndex(p, 3);
out.relpos = rel.item ? { client: rel.item.client, clock: rel.item.clock, ownClient: a.clientID } : null;

// 1. a gap: client X's clocks 0..4 are withheld, 5.. sent
const w = new Y.Doc();
const wt = w.get('content');
const wp = new Y.Node('paragraph');
wt.push([wp]);
const before = Y.encodeStateVector(w);
wp.insert(0, 'abc');
const first = Y.encodeStateAsUpdate(w, before);
const mid = Y.encodeStateVector(w);
wp.insert(3, 'def');
const second = Y.encodeStateAsUpdate(w, mid);
const g = new Y.Doc();
const gEvents: number[] = [];
g.on('update', (u: Uint8Array) => gEvents.push(u.length));
Y.applyUpdate(g, second); // without the paragraph and "abc"
out.gap = { after: state(g), updateEvents: gEvents, rootString: g.get('content').toString() };
Y.applyUpdate(g, Y.encodeStateAsUpdate(w, Y.encodeStateVector(g)));
out.gapFilled = { after: state(g), equal: g.get('content').toString() === wt.toString() };

// 2. a missing origin from another client: B types after A's text; the host has the paragraph but not A's text
const A = new Y.Doc();
const B = new Y.Doc();
A.get('content').push([new Y.Node('paragraph')]);
const paragraphOnly = Y.encodeStateAsUpdate(A);
Y.applyUpdate(B, paragraphOnly);
const aOnly = Y.encodeStateVector(A);
(A.get('content').get(0) as Y.Node).insert(0, 'from A');
Y.applyUpdate(B, Y.encodeStateAsUpdate(A, aOnly));
const bBefore = Y.encodeStateVector(B);
(B.get('content').get(0) as Y.Node).insert(6, ' then B');
const missingOrigin = new Y.Doc();
Y.applyUpdate(missingOrigin, paragraphOnly);
const moEvents: number[] = [];
missingOrigin.on('update', (u: Uint8Array) => moEvents.push(u.length));
Y.applyUpdate(missingOrigin, Y.encodeStateAsUpdate(B, bBefore));
out.missingOrigin = { after: state(missingOrigin), updateEvents: moEvents, text: missingOrigin.get('content').toString() };
// the step 2 such a host computes for a newcomer carries the parked bytes along
const leak = Y.encodeStateAsUpdate(missingOrigin);
const third = new Y.Doc();
Y.applyUpdate(third, leak);
out.pendingLeaksIntoStep2 = { thirdHasPending: state(third).pendingStructs, leakBytes: leak.length };

// 3. a deletion of a clock nobody has
const dDoc = new Y.Doc();
const fake = new Y.Doc();
fake.get('content').insert(0, 'xyz');
const fakeSv = Y.encodeStateVector(fake);
fake.get('content').delete(0, 3);
const delOnly = Y.encodeStateAsUpdate(fake, fakeSv);
Y.applyUpdate(dDoc, delOnly);
out.unknownDeletion = state(dDoc);

// 4. ContentMap attribution per update, merged, encoded
const log: { v1: Uint8Array; actor: string; at: number }[] = [];
const t = new Y.Doc();
t.on('update', (u: Uint8Array, origin: unknown) => log.push({ v1: u, actor: String(origin ?? 'x'), at: Date.now() + log.length * 1000 }));
const tp = new Y.Node('paragraph');
t.transact(() => t.get('content').push([tp]), 'session:a');
t.transact(() => tp.insert(0, 'agent text '), 'session:a');
for (const ch of 'human') t.transact(() => tp.insert(tp.length, ch), 'human');
t.transact(() => tp.delete(0, 6), 'human');
const maps = log.map((e) =>
  Y.createContentMapFromContentIds(
    Y.createContentIdsFromUpdate(e.v1),
    [Y.createContentAttribute('insert', e.actor), Y.createContentAttribute('insertAt', e.at)],
    [Y.createContentAttribute('delete', e.actor), Y.createContentAttribute('deleteAt', e.at)],
  ),
);
const merged = Y.mergeContentMaps(maps);
const enc = Y.encodeContentMap(merged);
const back = Y.decodeContentMap(enc);
const attrs = (ranges: { attrs: { name: string; val: unknown }[] | null }[]) => ranges.map((r) => (r.attrs ?? []).map((a) => `${a.name}=${a.val}`));
out.contentMap = {
  perUpdateBytes: maps.map((m) => Y.encodeContentMap(m).length),
  mergedBytes: enc.length,
  insertOfFirstChar: attrs(back.inserts.slice(t.clientID, 1, 1)),
  deleteOfFirstChar: attrs(back.deletes.slice(t.clientID, 1, 1)),
  insertOfH: attrs(back.inserts.slice(t.clientID, 12, 1)),
};
console.log(JSON.stringify(out, null, 2));
