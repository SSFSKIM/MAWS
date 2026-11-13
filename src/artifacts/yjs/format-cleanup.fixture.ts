// Test material for l6-artifacts-07 (a), "a formatting clean-up is never a write of its own" (imported by tests only):
// a doc built as build F (f1852de3a) builds one, and the reads a test needs to compare what docs hold beside their text.
import * as Y from '@y/y';
import type { Doc, Node } from './doc';

// A doc built with Yjs's defaults, which is what build F's `newDoc` is: it runs Yjs's post-apply formatting clean-up.
// The pin's positive control, and the other build of the cross-build cases.
export const newDocAsF = (): Doc => new Y.Doc({ gc: true });

// The formatting markers a text holds that are not deleted, redundant or not (a marker changes no character's format
// when the run it opens is empty or already has that format).
export function liveMarkers(text: Node): number {
  let count = 0;
  for (let item = text._start; item; item = item.right) if (!item.deleted && item.content instanceof Y.ContentFormat) count += 1;
  return count;
}

// A doc's deletions as plain data, ordered by client, to compare two docs' delete sets.
export function deletionsOf(doc: Doc): [number, [number, number][]][] {
  const out: [number, [number, number][]][] = [];
  Y.createDeleteSetFromStructStore(doc.store).clients.forEach((ranges, client) => out.push([client, ranges.getIds().map((range) => [range.clock, range.len])]));
  return out.sort((a, b) => a[0] - b[0]);
}
