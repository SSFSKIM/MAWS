// The binding module: provenance as v14's native attribution maps (X29 amended by Decision Log 25; this child's
// Decision Log 5 and 6). One map per committed update, built from the update's content ids: every id it inserts
// carries `insert = <actor key>` and `insertAt = <ms>`, every id it deletes `delete` and `deleteAt`, the times floored
// to the minute at write (parent Decision Log 29: S3 measured about 4x smaller maps, and one actor's typing within a
// minute coalesces into one range when maps merge). The host persists the maps encoded beside the log and merges them
// when it compacts; "who edited this" is a lookup by id in the merged map. Calls from P3-0's S1, S2 and S3
// (`s1/v14/s1-history.mjs`, `s2/v14/yjs.ts`, `s3/lib/provenance.mjs`).
import * as Y from '@y/y';
import type { Node } from './doc';

export type ContentIds = Y.ContentIds;
export type ContentMap = Y.ContentMap;
export interface ItemId {
  client: number;
  clock: number;
}
export interface Authorship {
  actor: string;
  at: number;
}

// What a V1 update inserts and deletes, as id sets.
export const contentIdsOf = (v1: Uint8Array): ContentIds => Y.createContentIdsFromUpdate(v1);

// The clientIDs an update writes structs under (what the host binds to an actor at first sight, Decision Log 6).
export const insertedClients = (ids: ContentIds): number[] => [...ids.inserts.clients.keys()];

// The resolution of every time in a map.
export const PROVENANCE_STEP_MS = 60_000;

// One update's map, its time floored to `PROVENANCE_STEP_MS`. Inserts are credited per clientID (`insertActor` as a
// function answers each clientID's binding, so a step 2 carrying another actor's structs credits that actor);
// deletions to the connection that sent them.
export function attributionMap(
  ids: ContentIds,
  { insertActor, deleteActor, at: exact }: { insertActor: string | ((clientId: number) => string); deleteActor: string; at: number },
): ContentMap {
  const at = exact - (exact % PROVENANCE_STEP_MS);
  const deleteAttrs = [Y.createContentAttribute('delete', deleteActor), Y.createContentAttribute('deleteAt', at)];
  const insertAttrs = (actor: string) => [Y.createContentAttribute('insert', actor), Y.createContentAttribute('insertAt', at)];
  if (typeof insertActor === 'string') return Y.createContentMapFromContentIds(ids, insertAttrs(insertActor), deleteAttrs);
  const byActor = new Map<string, Y.IdSet>();
  ids.inserts.forEach((range, client) => {
    const actor = insertActor(client);
    const set = byActor.get(actor) ?? Y.createIdSet();
    set.add(client, range.clock, range.len);
    byActor.set(actor, set);
  });
  const inserts = [...byActor].map(([actor, set]) => Y.createIdMapFromIdSet(set, insertAttrs(actor)));
  return Y.createContentMap(Y.mergeIdMaps(inserts), Y.createIdMapFromIdSet(ids.deletes, deleteAttrs));
}

export const mergeMaps = (maps: ContentMap[]): ContentMap => Y.mergeContentMaps(maps);
// P3-B (parent Decision Log 57): `over` laid on `beneath`, `over`'s attribution winning on every id both maps hold
// (`mergeMaps` joins a shared id's attributes, and the lookups read the first).
export const overlayMap = (beneath: ContentMap, over: ContentMap): ContentMap => mergeMaps([Y.excludeContentMap(beneath, over), over]);
export const encodeMap = (map: ContentMap): Uint8Array => Y.encodeContentMap(map);
export const decodeMap = (bytes: Uint8Array): ContentMap => Y.decodeContentMap(bytes);

const authorship = (attrs: readonly { name: string; val: unknown }[] | null | undefined, who: 'insert' | 'delete'): Authorship | null => {
  const actor = attrs?.find((attr) => attr.name === who)?.val;
  const at = attrs?.find((attr) => attr.name === `${who}At`)?.val;
  return typeof actor === 'string' && typeof at === 'number' ? { actor, at } : null;
};
export const insertedBy = (map: ContentMap, id: ItemId): Authorship | null => authorship(map.inserts.slice(id.client, id.clock, 1)[0]?.attrs, 'insert');
export const deletedBy = (map: ContentMap, id: ItemId): Authorship | null => authorship(map.deletes.slice(id.client, id.clock, 1)[0]?.attrs, 'delete');

// A move or a retype as a kind's `afterUpdate` reports it (Decision Log 25j; parent Decision Log 34): the update
// re-inserted the content at `from` (ids as `[client, clock]`, one per character or element) as the content at `to`,
// pairwise, so `to` keeps `from`'s author and time and the mover is credited with no characters. The host's own
// suggestion copies carry the same way (Decision Log 45): `accept`, an accepted proposal's copy keeping its author and
// time; `reject`, content a rejected deletion brings back keeping its original author.
export interface Carry {
  kind: 'move' | 'retype' | 'accept' | 'reject';
  from: [number, number][];
  to: [number, number][];
}

// `map` (one update's attribution) with each carried `to` id re-credited to its `from` id's author and time (looked up
// in `prior`, the artifact's attribution before this update, then in `map` itself) and marked `carry = <kind>`, so
// history can show moved and retyped blocks. A pair whose `to` the update did not insert, or whose `from` has no
// recorded author, is left as it was. Deletions are untouched: they stay the mover's.
export function carryAttribution(map: ContentMap, prior: ContentMap, carries: Carry[]): ContentMap {
  const taken = Y.createIdSet();
  const groups = new Map<string, { attrs: Y.ContentAttribute<unknown>[]; ids: Y.IdSet }>();
  for (const carry of carries) {
    for (let i = 0; i < Math.min(carry.from.length, carry.to.length); i++) {
      const to = { client: carry.to[i][0], clock: carry.to[i][1] };
      const from = { client: carry.from[i][0], clock: carry.from[i][1] };
      if (!insertedBy(map, to)) continue;
      const author = insertedBy(prior, from) ?? insertedBy(map, from);
      if (!author) continue;
      taken.add(to.client, to.clock, 1);
      const key = `${author.actor}\u0000${author.at}\u0000${carry.kind}`;
      const group = groups.get(key) ?? {
        attrs: [Y.createContentAttribute('insert', author.actor), Y.createContentAttribute('insertAt', author.at), Y.createContentAttribute('carry', carry.kind)],
        ids: Y.createIdSet(),
      };
      group.ids.add(to.client, to.clock, 1);
      groups.set(key, group);
    }
  }
  if (taken.isEmpty()) return map;
  const carried = [...groups.values()].map(({ attrs, ids }) => Y.createIdMapFromIdSet(ids, attrs));
  return Y.createContentMap(Y.mergeIdMaps([Y.diffIdMap(map.inserts, taken), ...carried]), map.deletes);
}

// The carry kind recorded on an inserted id, or null when it was not carried.
export function carriedBy(map: ContentMap, id: ItemId): Carry['kind'] | null {
  const value = map.inserts.slice(id.client, id.clock, 1)[0]?.attrs?.find((attr: { name: string }) => attr.name === 'carry')?.val;
  return value === 'move' || value === 'retype' || value === 'accept' || value === 'reject' ? value : null;
}

// The id of the content at `index` of a node's text and children (what a selection's start resolves to).
export function idAt(node: Node, index: number): ItemId | null {
  const position = Y.createRelativePositionFromTypeIndex(node, index);
  return position.item ? { client: position.item.client, clock: position.item.clock } : null;
}
