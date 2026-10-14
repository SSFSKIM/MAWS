// A realistic document of a given size for the store's measured case (docs/doperpowers/plans/2026-10-12-p3-a-store.md,
// M9): S2's v14 seed (`master:spikes/p3-store/s2/check/seed-v14.ts`), copied, never imported. Paragraph nodes under the
// `content` root written a word per transaction by three synced writers, about 4 % of words partly deleted and 3 %
// re-formatted bold, so the state holds the many small items, clients and delete sets a typed document has (one big
// insert would merge into a few items and sync in no time). The same content every run; the writers' clientIDs are
// random, so the state's size varies by a few hundred bytes.
//
// Yjs is loaded with `require` and typed here as far as the seed calls it: the binding module is the product's only
// import path to Yjs (Decision Log 25), and its declarations need that module's global shim (Decision Log 19a).
import { createRequire } from 'node:module';

interface YNode {
  readonly length: number;
  insert(index: number, content: string): void;
  push(content: YNode[]): void;
  delete(index: number, length: number): void;
  format(index: number, length: number, attributes: Record<string, unknown>): void;
}
interface YDoc {
  get(name: string): YNode;
}
interface Yjs {
  Doc: new () => YDoc;
  Node: new (name: string) => YNode;
  applyUpdate(doc: YDoc, update: Uint8Array): void;
  encodeStateAsUpdate(doc: YDoc, stateVector?: Uint8Array): Uint8Array;
  encodeStateVector(doc: YDoc): Uint8Array;
  encodeStateAsUpdateV2(doc: YDoc): Uint8Array;
}

// The seed's V2 state, at least `targetBytes` long.
export function seedDocument(targetBytes: number): Uint8Array {
  const Y = createRequire(__filename)('@y/y') as Yjs;
  const words = 'the quick brown fox jumps over lazy dogs while agents draft sections of the quarterly plan and humans edit'.split(' ');
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const clients = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
  const sync = () => {
    for (const a of clients) for (const b of clients) if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  };
  let size = 0;
  let paragraphs = 0;
  while (size < targetBytes) {
    for (let k = 0; k < 50; k++) {
      const writer = clients[paragraphs % clients.length];
      const paragraph = new Y.Node('paragraph');
      writer.get('content').push([paragraph]);
      const n = 20 + Math.floor(rand() * 50);
      for (let w = 0; w < n; w++) {
        paragraph.insert(paragraph.length, `${words[Math.floor(rand() * words.length)]} `);
        if (rand() < 0.04 && paragraph.length > 6) paragraph.delete(paragraph.length - 5, 3);
        if (rand() < 0.03 && paragraph.length > 10) paragraph.format(paragraph.length - 8, 6, { bold: true });
      }
      paragraphs += 1;
      if (paragraphs % 3 === 0) sync();
    }
    sync();
    size = Y.encodeStateAsUpdateV2(clients[0]).length;
  }
  return Y.encodeStateAsUpdateV2(clients[0]);
}
