// What changed in a document since a revision (D7's `sinceRevision` of docs/doperpowers/plans/2026-10-12-p3-b-documents.md;
// Claude Docs' `sinceRev`): the top-level blocks whose text or attributes the changes since then touched, found from the
// changes' item ids (the host's provenance between the two revisions) resolved to the blocks that hold them, and the
// block ids that existed then and exist nowhere now. Pure: the host's tool supplies the ids and the earlier id set.
import type { Doc } from '../yjs';
import { ContentType, Item, YNode, findIndexSS } from '../yjs/document';
import { DocIndex, type TopBlock } from './block-index';

/** Id ranges as Yjs's id sets and id maps iterate them (a provenance map's `inserts` and `deletes`). */
export interface IdRanges {
  forEach(f: (range: { clock: number; len: number }, client: number) => void): void;
}

/** Every block id in the doc, at any depth, in every tab. */
export function blockIdsOf(doc: Doc): Set<string> {
  const index = DocIndex.of(doc);
  const ids = new Set<string>();
  for (const tabId of index.tabIds()) for (const top of index.tops(tabId)) for (const [id] of top.pairs) ids.add(id);
  return ids;
}

/**
 * The live top-level blocks holding an item the ranges name: text or a node inserted or deleted inside the block, an
 * attribute set on it or on anything in it, or the block itself inserted (a new or moved block). A deleted block names
 * nothing here (its node is collected); `deletedSince` lists it.
 */
export function touchedBlocks(doc: Doc, ...ranges: IdRanges[]): Set<TopBlock> {
  const index = DocIndex.of(doc);
  const touched = new Set<TopBlock>();
  const note = (item: Item): void => {
    const own = item.content instanceof ContentType ? index.topOf(item.content.type as never) : null;
    const top = own ?? (item.parent instanceof YNode ? index.topOf(item.parent) : null);
    if (top) touched.add(top);
  };
  for (const set of ranges) {
    set.forEach(({ clock, len }, client) => {
      const structs = doc.store.clients.get(client);
      const end = Math.min(clock + len, doc.store.getClock(client));
      if (!structs || clock >= end) return;
      for (let i = findIndexSS(structs, clock); i < structs.length && structs[i].id.clock < end; i++) {
        const struct = structs[i];
        if (struct instanceof Item) note(struct);
      }
    });
  }
  return touched;
}

/** The ids of `before` (a block id set read earlier) that no block of the doc carries now. */
export function deletedSince(doc: Doc, before: Iterable<string>): string[] {
  const index = DocIndex.of(doc);
  return [...before].filter((id) => index.find(id) === null);
}
