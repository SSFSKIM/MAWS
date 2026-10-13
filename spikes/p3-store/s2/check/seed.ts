// S2: seed documents of a given V2 state size, shaped like a typed document (paragraphs of XmlText, word-at-a-time
// transactions, ~4 % deletions, some bold runs, several clients), written as V2 state files the harness imports as a
// version. Usage: seed <outFile> <targetBytes>
import { writeFileSync } from 'node:fs';
import * as Y from 'yjs';

const [outFile, target] = [process.argv[2], Number(process.argv[3])];
const words = 'the quick brown fox jumps over lazy dogs while agents draft sections of the quarterly plan and humans edit'.split(' ');
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const clients = [new Y.Doc(), new Y.Doc(), new Y.Doc()]; // three writers, synced as they go
const main = clients[0];
const frag = (d: Y.Doc) => d.getXmlFragment('content');
const sync = () => {
  for (const a of clients) for (const b of clients) if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
};
let size = 0;
let paragraphs = 0;
const started = Date.now();
while (size < target) {
  for (let k = 0; k < 50; k++) {
    const writer = clients[paragraphs % clients.length];
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    p.insert(0, [t]);
    frag(writer).push([p]);
    const n = 20 + Math.floor(rand() * 50);
    for (let w = 0; w < n; w++) {
      t.insert(t.length, `${words[Math.floor(rand() * words.length)]} `);
      if (rand() < 0.04 && t.length > 6) t.delete(t.length - 5, 3);
      if (rand() < 0.03 && t.length > 10) t.format(t.length - 8, 6, { bold: true });
    }
    paragraphs += 1;
    if (paragraphs % 3 === 0) sync();
  }
  sync();
  size = Y.encodeStateAsUpdateV2(main).length;
}
const state = Y.encodeStateAsUpdateV2(main);
writeFileSync(outFile, state);
console.log(JSON.stringify({ outFile, v2Bytes: state.length, v1Bytes: Y.encodeStateAsUpdate(main).length, paragraphs, chars: frag(main).toString().length, ms: Date.now() - started }));
