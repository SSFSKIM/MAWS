// The binding module: untrusted V1 update bytes from a replica, checked before they touch an authoritative doc
// (Decision Log 26: every incoming update is checked before it is applied; the doc is evicted if anything stays
// pending). Ported from P3-0's S2 (`spikes/p3-store/s2/v14/yjs.ts`, `checkV1`) and its v14 probes
// (`s2/check/v14-probe.ts`, `v14-gap-probe.ts`), which showed what plain v14 does with the shapes refused here:
//   - a gap in one client's clocks is integrated behind a `Skip` placeholder (`store.skips`): the content shows, the
//     'update' event carries it, the state vector stops at the hole, and every newcomer's step 2 copies the hole;
//   - a missing origin or parent, or a deletion of clocks nobody has, is parked silently as `pendingStructs` or
//     `pendingDs`, with no 'update' event, and `encodeStateAsUpdate` appends the parked bytes to every step 2.
// Either way the doc would hold state outside the log, where an ack would lie. The rule mirrored is v14's
// `Item.getMissing` (encoding.js) plus the gap v14 no longer parks.
import * as Y from '@y/y';
import type { Doc } from './doc';

// Null when `update` may be applied to `doc`; otherwise why not. The update must decode; each client's structs must
// continue from what the doc has (no gap); every left and right origin and every ID parent must exist in the doc (not
// behind a skip) or in the update itself; deletions may name only clocks the doc or the update has. A live ID parent
// must be a type (anything else is a forged structure). A parent that is deleted, or collected to a GC struct or to
// ContentDeleted, is admitted: v14's integrator (encoding.js, the parent branch of `readStructs`' integration, and
// `Item.integrate`) turns an item under it into a tombstone with nothing pending, which is what a concurrent "type
// into a node another replica deleted" must do.
export function checkUpdate(doc: Doc, update: Uint8Array): string | null {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch (error) {
    return `undecodable update (${error instanceof Error ? error.message : String(error)})`;
  }
  const store = doc.store;
  // Pass 1: per client, the clock the doc plus the update reach; a gap is refused here.
  const reach = new Map<number, number>();
  const have = (client: number) => Math.max(reach.get(client) ?? 0, store.getClock(client));
  const items = new Map<number, Y.Item[]>(); // the update's own items per client, in clock order (as decoded)
  for (const struct of decoded.structs) {
    if (struct instanceof Y.Skip) return 'an update with a skip (a gap)';
    const { client, clock } = struct.id;
    if (clock > have(client)) return `a gap for client ${client} (clock ${clock}, have ${have(client)})`;
    reach.set(client, Math.max(have(client), clock + struct.length));
    if (struct instanceof Y.Item) {
      const own = items.get(client);
      if (own) own.push(struct);
      else items.set(client, [struct]);
    }
  }
  // Pass 2: references, against everything the update brings (Yjs encodes clients in descending order, so an origin
  // may sit in a later block of the same update).
  const exists = (id: Y.ID) => id.clock < have(id.client) && !store.skips.hasId(id);
  for (const struct of decoded.structs) {
    if (!(struct instanceof Y.Item)) continue;
    if (struct.origin && !exists(struct.origin)) return `an origin that does not exist (${struct.origin.client}:${struct.origin.clock})`;
    if (struct.rightOrigin && !exists(struct.rightOrigin)) return `a right origin that does not exist (${struct.rightOrigin.client}:${struct.rightOrigin.clock})`;
    const parent = struct.parent as unknown;
    if (parent instanceof Y.ID) {
      if (!exists(parent)) return `a parent that does not exist (${parent.client}:${parent.clock})`;
      // The doc's own struct wins over a re-sent copy in the update: it carries the deletion state.
      const target = parent.clock < store.getClock(parent.client) ? store.getItem(parent) : ownItemAt(items.get(parent.client), parent.clock);
      // A collected type travels as ContentDeleted, and one that arrives in this update is not flagged deleted until it
      // integrates, so the content is checked as well as the flag.
      const collected = target instanceof Y.Item && (target.deleted || target.content instanceof Y.ContentDeleted);
      if (target instanceof Y.Item && !collected && !(target.content instanceof Y.ContentType)) return 'a parent that is not a type';
    }
  }
  let refused: string | null = null;
  decoded.ds.forEach((range, client) => {
    if (refused === null && range.clock + range.len > have(client)) refused = `a deletion past clock ${have(client)} for client ${client}`;
  });
  return refused;
}

// The update's item covering `clock`, by binary search over one client's items in clock order.
function ownItemAt(items: Y.Item[] | undefined, clock: number): Y.Item | null {
  if (!items) return null;
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const item = items[mid];
    if (clock < item.id.clock) high = mid - 1;
    else if (clock >= item.id.clock + item.length) low = mid + 1;
    else return item;
  }
  return null;
}

// The clientIDs under which an update (as its content ids) writes structs the doc does not have yet: what the host
// binds to the sending actor, or refuses when bound to another (Decision Log 6). Structs it restates are no-ops.
export function newStructClients(doc: Doc, ids: Y.ContentIds): number[] {
  const clients: number[] = [];
  ids.inserts.forEach((range, client) => {
    if (range.clock + range.len > doc.store.getClock(client) && clients.at(-1) !== client) clients.push(client);
  });
  return clients;
}

// Whether applying an update (as its content ids) would change the doc: a new struct, or a deletion of content the doc
// has not deleted. A step 2 restates its sender's whole delete set, so only the difference counts. Building the doc's
// delete set walks its store: for the rare caller (a store opened read-only), not the commit path.
export function wouldChange(doc: Doc, ids: Y.ContentIds): boolean {
  if (newStructClients(doc, ids).length > 0) return true;
  return !Y.diffIdSet(ids.deletes, Y.createDeleteSetFromStructStore(doc.store)).isEmpty();
}

// After an apply: parked structs or deletions, or a hole behind a skip, mean `checkUpdate` missed a case and the doc
// holds state the log does not (the caller evicts it).
export const hasPending = (doc: Doc): boolean => doc.store.pendingStructs !== null || doc.store.pendingDs !== null || !doc.store.skips.isEmpty();
