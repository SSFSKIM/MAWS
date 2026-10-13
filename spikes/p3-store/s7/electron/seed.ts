// S7b seed: the 200-page document (about 100k words) as a V2 state file the harness imports as a version, and the
// 100-slide deck's source files. The document is written by three clients through the v14 writer (one transaction per
// section, like an agent's create batches), then roughened by a human typing 6,000 words at random places (42,000
// keystrokes, one transaction each), about 400 word deletions and 300 bold formats, synced between the clients as it goes (S2's seed method), so the
// item structure is a typed-and-edited document rather than one import.
// Usage: ELECTRON_RUN_AS_NODE=1 <Electron> seed.cjs <outDir> [sections]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from '@y/y';
import { schemaFor } from './schema.mjs';
import { blockDelta, body, createArtifact, measure, prng, sectionJSON, textBlocks, textOf } from './doc';
import { deckSourceFiles } from './deck-source';

const outDir = process.argv[2] ?? '/tmp/p3-s7b';
const sections = Number(process.argv[3] ?? 160); // 160 sections ≈ 100k words ≈ 200 pages
mkdirSync(outDir, { recursive: true });
const schema = schemaFor({});
const r = prng(11);
const started = performance.now();
const clients = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
const sync = () => {
  for (const a of clients) for (const b of clients) if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
};
createArtifact(clients[0]);
sync();
for (let s = 0; s < sections; s++) {
  const w = clients[s % 2]; // two "agents" write the sections
  w.transact(() => {
    const root = body(w);
    root.insert(root.length, sectionJSON(s, r).map((j) => blockDelta(schema, j)));
  });
  if (s % 5 === 4) sync();
}
sync();
const human = clients[2];
const blocks = () => textBlocks(body(human)).filter((b) => b.name === 'paragraph');
let typed = 0;
let deleted = 0;
let formatted = 0;
for (let round = 0; round < Math.max(3, Math.round((sections * 60) / 160)); round++) {
  const bs = blocks();
  for (let k = 0; k < 100; k++) {
    // a typed word, one character per transaction (a keystroke each)
    const b = bs[Math.floor(r() * bs.length)];
    const s = textOf(b);
    let at = s.indexOf(' ', Math.floor(r() * Math.max(1, s.length - 1)));
    if (at < 0) at = s.length;
    for (const ch of ' edited') {
      human.transact(() => b.insert(at, ch));
      at += 1;
      typed += 1;
    }
  }
  for (let k = 0; k < 7; k++) {
    const b = bs[Math.floor(r() * bs.length)];
    const s = textOf(b);
    const i = s.indexOf(' ', Math.floor(r() * Math.max(1, s.length - 20))) + 1;
    const j = s.indexOf(' ', i);
    if (i > 0 && j > i) {
      human.transact(() => b.delete(i, j - i));
      deleted += 1;
    }
  }
  for (let k = 0; k < 5; k++) {
    const b = bs[Math.floor(r() * bs.length)];
    if (b.length > 30) {
      human.transact(() => b.format(10, 8, { bold: {} }));
      formatted += 1;
    }
  }
  sync();
}
sync();
const main = clients[0];
const v2 = Y.encodeStateAsUpdateV2(main);
const v1 = Y.encodeStateAsUpdate(main);
writeFileSync(join(outDir, 'seed-200p.v2'), v2);
// a structure probe: items in the store (the cost driver for load and first sync)
let items = 0;
main.store.clients.forEach((structs) => (items += structs.length));
const stats = { sections, ...measure(body(main)), v2Bytes: v2.length, v1Bytes: v1.length, v1OverV2: Math.round((v1.length / v2.length) * 100) / 100, structs: items, clients: main.store.clients.size, typed, deleted, formatted, ms: Math.round(performance.now() - started) };
// the 100-slide deck's files (S6's bench generator, copied in deck-source.ts)
const deck = deckSourceFiles(100);
writeFileSync(join(outDir, 'deck-100.json'), JSON.stringify(deck));
writeFileSync(join(outDir, 'seed-200p.json'), JSON.stringify(stats, null, 2));
console.log(JSON.stringify({ ...stats, deckFiles: Object.keys(deck).length, deckSourceBytes: Object.values(deck).reduce((n, s) => n + Buffer.byteLength(s), 0) }));
