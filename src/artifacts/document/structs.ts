// Struct-level reads of a document's Y.Doc that the patch writer and the host's adapter share (copied from P3-0's
// `s4/src/patch-writer.ts` and `s4/src/host.ts` helpers): a character or element's item id (a slot), the slots under a
// node in document order, the textblocks under a node, and where a slot is now. A slot outlives a node's ProseMirror
// form, which is why provenance carries and edit forwarding speak in slots.
import type { Doc, Node } from '../yjs';
import { ContentString, ContentType, Item, YNode, findIndexSS } from '../yjs/document';
import type { Slot } from './edit-ops';
import { schemaFor } from './schema';

export const slotKey = (slot: Slot | { client: number; clock: number }): string => (Array.isArray(slot) ? `${slot[0]}:${slot[1]}` : `${slot.client}:${slot.clock}`);
export const parseSlot = (key: string): Slot => {
  const [client, clock] = key.split(':');
  return [Number(client), Number(clock)];
};
export const itemOf = (node: Node): Slot => [node._item!.id.client, node._item!.id.clock];

/** Every visible slot's item id in document order, descending into child nodes (each node's own item first). */
export function deepSlotIds(node: Node, out: Slot[] = []): Slot[] {
  for (let item = node._start; item !== null; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const content = item.content;
    if (content instanceof ContentString) for (let k = 0; k < content.str.length; k++) out.push([item.id.client, item.id.clock + k]);
    else if (content instanceof ContentType) {
      out.push([item.id.client, item.id.clock]);
      deepSlotIds(content.type as Node, out);
    } else for (let k = 0; k < item.length; k++) out.push([item.id.client, item.id.clock + k]);
  }
  return out;
}

/** A textblock's visible characters with their slots (inline nodes skipped). */
export function charSlots(textblock: Node): Array<{ slot: Slot; ch: string }> {
  const out: Array<{ slot: Slot; ch: string }> = [];
  for (let item = textblock._start; item !== null; item = item.right) {
    if (item.deleted || !item.countable || !(item.content instanceof ContentString)) continue;
    const text = item.content.str;
    for (let k = 0; k < text.length; k++) out.push({ slot: [item.id.client, item.id.clock + k], ch: text[k] });
  }
  return out;
}

/** The textblock nodes under a Y node (the node itself if it is one). */
export function textblocksY(node: Node): Node[] {
  const schema = schemaFor();
  const out: Node[] = [];
  const walk = (at: Node): void => {
    if (schema.nodes[at.name]?.isTextblock) out.push(at);
    else for (const child of at.toArray()) if (child instanceof YNode) walk(child);
  };
  walk(node);
  return out;
}

/** The item holding `slot` in `doc`, or null when the doc has no such struct (or only a collected one). */
export function itemAt(doc: Doc, slot: Slot): Item | null {
  const structs = doc.store.clients.get(slot[0]);
  if (!structs || slot[1] >= doc.store.getClock(slot[0])) return null;
  const struct = structs[findIndexSS(structs, slot[1])];
  return struct instanceof Item ? struct : null;
}

/** Whether `doc` has `slot` at all (live, deleted or collected). */
export const hasSlot = (doc: Doc, slot: Slot): boolean => slot[1] < doc.store.getClock(slot[0]);

/** The live node whose own item is `slot`, or null. */
export function nodeAt(doc: Doc, slot: Slot): Node | null {
  const item = itemAt(doc, slot);
  return item && !item.deleted && item.content instanceof ContentType ? (item.content.type as Node) : null;
}

/** The node holding a live slot and the slot's index in it; null if the slot is deleted or unknown. */
export function locateSlot(doc: Doc, slot: Slot): { node: Node; index: number } | null {
  const item = itemAt(doc, slot);
  if (!item || item.deleted || !(item.parent instanceof YNode)) return null;
  let index = 0;
  for (let at = (item.parent as Node)._start; at && at !== item; at = at.right) if (!at.deleted && at.countable) index += at.length;
  return { node: item.parent as Node, index: index + (slot[1] - item.id.clock) };
}

/** The format of the character left of `index` in a textblock, comments left out (typing at a comment's edge does not extend it). */
export function formatAt(node: Node, index: number, isComment: (key: string) => boolean): Record<string, unknown> {
  if (index <= 0) return {};
  let at = 0;
  for (const op of (node.toDelta() as unknown as { children: Iterable<{ insert: string | unknown[]; format?: Record<string, unknown> | null }> }).children) {
    at += op.insert.length;
    if (at >= index) return Object.fromEntries(Object.entries(op.format ?? {}).filter(([key]) => !isComment(key)));
  }
  return {};
}
