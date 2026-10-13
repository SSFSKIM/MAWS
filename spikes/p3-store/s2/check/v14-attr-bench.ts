// S2 v14: the host's per-update attribution cost and size (ContentMap per keystroke), the merge on compaction and the
// minute bucketing on thinning, against the v13 range rows' size. 2,000 keystrokes by two actors plus deletions.
import * as Y from '@y/y';
import { attributionOf, bucketAttribution, encodeAttribution, insertedBy, mergeAttributions } from '../v14/yjs';

const doc = new Y.Doc();
const p = new Y.Node('paragraph');
doc.get('content').push([p]);
const updates: { u: Uint8Array; actor: string; at: number }[] = [];
let at = Date.parse('2026-10-12T09:00:00Z');
let actor = 'human';
doc.on('update', (u: Uint8Array) => updates.push({ u, actor, at }));
for (let i = 0; i < 2000; i++) {
  actor = i % 400 < 300 ? 'human' : 'session:agent-1';
  at += 120; // a keystroke every 120 ms
  p.insert(p.length, 'x');
  if (i % 50 === 49) p.delete(p.length - 5, 2);
}
const t0 = performance.now();
const rows = updates.map((e) => encodeAttribution(attributionOf(e.u, e.actor, e.at)));
const perUpdateUs = ((performance.now() - t0) / updates.length) * 1000;
const t1 = performance.now();
const merged = mergeAttributions(rows.map((r) => Y.decodeContentMap(r)));
const mergeMs = performance.now() - t1;
const mergedBytes = encodeAttribution(merged).length;
const t2 = performance.now();
const thinned = bucketAttribution(merged, 60_000);
const thinMs = performance.now() - t2;
const thinnedBytes = encodeAttribution(thinned).length;
console.log(JSON.stringify({
  updates: updates.length,
  perUpdate: { us: Math.round(perUpdateUs * 10) / 10, avgBytes: Math.round(rows.reduce((s, r) => s + r.length, 0) / rows.length) },
  merged: { ms: Math.round(mergeMs * 10) / 10, bytes: mergedBytes },
  thinnedToMinute: { ms: Math.round(thinMs * 10) / 10, bytes: thinnedBytes, sample: insertedBy(thinned, doc.clientID, 10) },
  v13RangeRowsEstimate: 'about 58 B per keystroke row (s2/out/latency-fullfsync.json: 52,548 B for 906 rows)',
}, null, 2));
