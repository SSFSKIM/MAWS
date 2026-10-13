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
export const encodeMap = (map: ContentMap): Uint8Array => Y.encodeContentMap(map);
export const decodeMap = (bytes: Uint8Array): ContentMap => Y.decodeContentMap(bytes);

const authorship = (attrs: readonly { name: string; val: unknown }[] | null | undefined, who: 'insert' | 'delete'): Authorship | null => {
  const actor = attrs?.find((attr) => attr.name === who)?.val;
  const at = attrs?.find((attr) => attr.name === `${who}At`)?.val;
  return typeof actor === 'string' && typeof at === 'number' ? { actor, at } : null;
};
export const insertedBy = (map: ContentMap, id: ItemId): Authorship | null => authorship(map.inserts.slice(id.client, id.clock, 1)[0]?.attrs, 'insert');
export const deletedBy = (map: ContentMap, id: ItemId): Authorship | null => authorship(map.deletes.slice(id.client, id.clock, 1)[0]?.attrs, 'delete');

// The id of the content at `index` of a node's text and children (what a selection's start resolves to).
export function idAt(node: Node, index: number): ItemId | null {
  const position = Y.createRelativePositionFromTypeIndex(node, index);
  return position.item ? { client: position.item.client, clock: position.item.clock } : null;
}
