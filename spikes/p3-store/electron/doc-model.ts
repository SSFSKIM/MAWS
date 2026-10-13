// S2 harness: the schema-agnostic test document (a `content` XmlFragment of paragraphs, as the seed builds) and the
// helpers every process uses to type into it, digest it and find who wrote a marker.
import * as Y from 'yjs';

export const fragment = (doc: Y.Doc) => doc.getXmlFragment('content');

// A new paragraph at the end, owned by one writer; returns its text.
export function newParagraph(doc: Y.Doc): Y.XmlText {
  const p = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  p.insert(0, [t]);
  fragment(doc).push([p]);
  return t;
}

const plain = (t: Y.XmlText) => (t.toDelta() as { insert: unknown }[]).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('');

// FNV-1a over the fragment's XML, with its length: equal digests mean equal documents for the harness.
export function digest(doc: Y.Doc): { length: number; fnv: string } {
  const s = fragment(doc).toString();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return { length: s.length, fnv: h.toString(16) };
}

// The XmlText and offset of a marker's first character, searching paragraphs from the end (live edits are appended).
export function findMarker(doc: Y.Doc, marker: string): { text: Y.XmlText; index: number } | null {
  const children = fragment(doc).toArray();
  for (let i = children.length - 1; i >= 0; i--) {
    const p = children[i];
    if (!(p instanceof Y.XmlElement)) continue;
    const t = p.get(0);
    if (!(t instanceof Y.XmlText)) continue;
    const at = plain(t).indexOf(marker);
    if (at >= 0) return { text: t, index: at };
  }
  return null;
}

export const now = () => performance.timeOrigin + performance.now();
export const clockOf = (doc: Y.Doc, client: number): number => Y.getState(doc.store, client);
