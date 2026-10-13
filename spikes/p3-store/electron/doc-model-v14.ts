// S2 harness on Yjs v14: the test document as v14 shapes it (a `content` node of paragraph nodes holding their text
// directly) and the same helpers as doc-model.ts (v13), so the harness runs either generation unchanged.
import * as Y from '@y/y';

export const fragment = (doc: Y.Doc) => doc.get('content');

// A new paragraph at the end, owned by one writer; returns the node its text goes into.
export function newParagraph(doc: Y.Doc): Y.Node {
  const p = new Y.Node('paragraph');
  fragment(doc).push([p]);
  return p;
}

const plain = (p: Y.Node): string => {
  const delta = p.toDelta() as unknown as { children: Iterable<{ insert?: unknown }> };
  let s = '';
  for (const op of delta.children) if (typeof op.insert === 'string') s += op.insert;
  return s;
};

export function digest(doc: Y.Doc): { length: number; fnv: string } {
  const s = fragment(doc).toString();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return { length: s.length, fnv: h.toString(16) };
}

export function findMarker(doc: Y.Doc, marker: string): { text: Y.Node; index: number } | null {
  const children = fragment(doc).toArray();
  for (let i = children.length - 1; i >= 0; i--) {
    const p = children[i];
    if (!(p instanceof Y.Node)) continue;
    const at = plain(p).indexOf(marker);
    if (at >= 0) return { text: p, index: at };
  }
  return null;
}

export const clockOf = (doc: Y.Doc, client: number): number => doc.store.getClock(client);
export const now = () => performance.timeOrigin + performance.now();
