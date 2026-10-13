// Where people's carets are, for the patch writer's move rule (§4.4: a move never re-inserts a block holding a live
// human caret; D6's `carets`): every other replica's awareness state that publishes a cursor (the binding's cursor
// plugin writes `cursor: {anchor, head}` as relative positions), resolved in `doc` to the block the caret's head is in.
import type { Doc, Node } from '../yjs';
import { YNode, createAbsolutePositionFromRelativePosition, createRelativePositionFromJSON } from '../yjs/document';

/** The id of `node` or of its nearest ancestor that has one. */
const blockIdOf = (node: Node | null): string | null => {
  for (let at = node; at; at = at.parent) {
    const id: unknown = at.getAttr('id');
    if (typeof id === 'string') return id;
  }
  return null;
};

/**
 * The carets of the awareness `states` other than `self`'s, as the writer takes them: the block holding each caret's
 * head and the head's offset in it. A state without a cursor, or whose cursor no longer resolves, adds none.
 */
export function caretsOf(states: ReadonlyMap<number, unknown>, doc: Doc, self?: number): Array<{ blockId: string; pos: number }> {
  const out: Array<{ blockId: string; pos: number }> = [];
  states.forEach((state, clientId) => {
    if (clientId === self || state === null || typeof state !== 'object') return;
    const cursor = (state as { cursor?: { head?: unknown } | null }).cursor;
    if (!cursor || cursor.head == null) return;
    try {
      const at = createAbsolutePositionFromRelativePosition(createRelativePositionFromJSON(cursor.head), doc, false);
      const type = at?.type;
      const blockId = type instanceof YNode ? blockIdOf(type) : null;
      if (blockId !== null) out.push({ blockId, pos: at!.index });
    } catch {
      // a malformed cursor from a replica names no caret
    }
  });
  return out;
}
