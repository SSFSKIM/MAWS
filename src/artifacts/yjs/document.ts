// P3-B's file in the binding module (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, "One Yjs import path"): the
// `@y/y` runtime names the document kind needs that the module's entry (index.ts, P3-A's) exports only as types or not
// at all: the node constructor for the tabs and threads maps, the relative positions a thread's anchor stores, the
// undo manager the editor scopes to its binding, and the renderer and gc-off docs of history (M1); and the struct-level
// reads of the patch writer and the document adapter (M2): an item's content kinds (a character's id for provenance
// carries, a node's own item for the move-copy rule), the struct store lookup, an update decoded before it is applied
// (the host's edit forwarding), and id sets built into the `keep` of a restore's scope. Kept to exactly these; P3-A
// absorbs them into index.ts at the next re-pin and this file goes.
import * as Y from '@y/y';

export {
  Node as YNode,
  UndoManager,
  DiffRenderer,
  createDiffRenderer,
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromJSON,
  createRelativePositionFromTypeIndex,
  relativePositionToJSON,
  // M2: the writer's and the adapter's struct-level reads
  Item,
  ContentString,
  ContentType,
  decodeUpdate,
  findIndexSS,
  createIdSet,
  createContentIds,
} from '@y/y';
export type { Transaction } from '@y/y'; // a suggestion replica's update, read by `proposesOver`

// History's throwaway docs (a version's state and the state it is compared with) keep deleted content, so the diff
// renderer can show what a change removed; the live doc is gc on (index.ts's `newDoc`).
export const newDocGcOff = (): Y.Doc => new Y.Doc({ gc: false });

// The clock after the last struct `store` holds of `client` (0 when it holds none).
const stateOf = (store: Y.Doc['store'], client: number): number => {
  const last = store.clients.get(client)?.at(-1);
  return last ? last.id.clock + last.length : 0;
};

/**
 * Whether a transaction on a suggestion replica proposed something over `base` (D14, M9 addendum fix wave): a struct
 * `base` lacks, or a deletion of content `base` still holds. The base flowing into the replica and the service
 * withdrawing settled proposals (content `base` never had) propose nothing. Reads only the transaction's own ranges, so
 * the review can skip a typing keystroke without the attribution its renderer keeps for every settled proposal.
 */
export function proposesOver(tr: Y.Transaction, base: Y.Doc): boolean {
  let proposed = false;
  tr.insertSet.forEach((range, client) => {
    if (stateOf(base.store, client) < range.clock + range.len) proposed = true;
  });
  if (proposed) return true;
  tr.deleteSet.forEach((range, client) => {
    const structs = base.store.clients.get(client);
    const end = Math.min(range.clock + range.len, stateOf(base.store, client));
    if (proposed || !structs || range.clock >= end) return;
    for (let i = Y.findIndexSS(structs, range.clock); i < structs.length && structs[i].id.clock < end; i++) {
      if (!structs[i].deleted) {
        proposed = true;
        return;
      }
    }
  });
  return proposed;
}
