// S2 on Yjs v14 (the S1 ruling: @y/y 14.0.0-rc.28) → P3-A's `src/engine-host/documents/yjs.ts`: the one module the
// host's document service calls Yjs through. The v13 variant is `s2/src/yjs-seam.ts`, kept for comparison.
//
// What changed from v13 (verified, s2/check/v14-probe.ts and v14-gap-probe.ts):
//   - one shared type, `Y.Node` (`doc.get(key)`), with text and child nodes in the same node;
//   - the delete set of a decoded update is an IdSet (`clients: Map<client, IdRanges>`, `getIds()`);
//   - a gap in one client's clocks is no longer parked: v14 integrates the later structs behind a `Skip` placeholder
//     (`store.skips`), the content is visible, the 'update' event carries it, and the state vector stops at the hole
//     (and a newcomer's step 2 copies the hole). A missing origin or parent, or a deletion of unknown clocks, is still
//     parked silently as `pendingStructs` / `pendingDs`, with no 'update' event, and `encodeStateAsUpdate` appends the
//     parked bytes to every step 2 it computes, so a newcomer inherits them;
//   - client ids are 53-bit (SQLite INTEGER holds them; a u32 does not);
//   - attribution is native: a ContentMap (IdMaps of inserts and deletes, each id range with its attributes).
import * as Y from '@y/y';

export type Doc = Y.Doc;
export type ContentMap = ReturnType<typeof Y.createContentMap>;
// One attributed id range as an IdMap's forEach hands it out (the rc's d.ts leaves the callback untyped here).
export type AttrRange = { clock: number; len: number; attrs: Y.ContentAttribute<unknown>[] | null };

export const newDoc = (): Doc => new Y.Doc({ gc: true });

// The wire (y-protocols) carries V1 updates, and so does the log; version states are V2.
export const stateVector = (doc: Doc): Uint8Array => Y.encodeStateVector(doc);
export const diffV1 = (doc: Doc, sv?: Uint8Array): Uint8Array => Y.encodeStateAsUpdate(doc, sv);
export const stateV2 = (doc: Doc): Uint8Array => Y.encodeStateAsUpdateV2(doc);
export const applyV1 = (doc: Doc, update: Uint8Array, origin: unknown): void => Y.applyUpdate(doc, update, origin);
export const applyV2 = (doc: Doc, update: Uint8Array, origin: unknown): void => Y.applyUpdateV2(doc, update, origin);
export const clockOf = (doc: Doc, client: number): number => doc.store.getClock(client);

export function onIntegrated(doc: Doc, listener: (update: Uint8Array, origin: unknown) => void): void {
  doc.on('update', (update: Uint8Array, origin: unknown) => listener(update, origin));
}

// One update's attribution (X29 on v14): every id it inserts carries `insert = actor, insertAt = at`, every id it
// deletes `delete = actor, deleteAt = at`. Encoded for the store; merged per bucket on compaction.
export function attributionOf(update: Uint8Array, actor: string, at: number): ContentMap {
  return Y.createContentMapFromContentIds(
    Y.createContentIdsFromUpdate(update),
    [Y.createContentAttribute('insert', actor), Y.createContentAttribute('insertAt', at)],
    [Y.createContentAttribute('delete', actor), Y.createContentAttribute('deleteAt', at)],
  );
}
export const encodeAttribution = (map: ContentMap): Uint8Array => Y.encodeContentMap(map);
export const decodeAttribution = (bytes: Uint8Array): ContentMap => Y.decodeContentMap(bytes);
export const mergeAttributions = (maps: ContentMap[]): ContentMap => Y.mergeContentMaps(maps);

// Thinning: the times rounded down to `bucketMs`, so adjacent ranges of one actor in one bucket coalesce.
export function bucketAttribution(map: ContentMap, bucketMs: number): ContentMap {
  const rebucket = (idmap: ContentMap['inserts']) => {
    const out = Y.createIdMap();
    idmap.forEach((range: AttrRange, client: number) => {
      const attrs = (range.attrs ?? []).map((a) => (a.name.endsWith('At') && typeof a.val === 'number' ? Y.createContentAttribute(a.name, a.val - (a.val % bucketMs)) : a));
      out.add(client, range.clock, range.len, attrs);
    });
    return out;
  };
  return Y.createContentMap(rebucket(map.inserts), rebucket(map.deletes));
}

export interface Authorship {
  actor: string;
  at: number;
}
const read = (attrs: { name: string; val: unknown }[] | null, who: string): Authorship | null => {
  const actor = attrs?.find((a) => a.name === who)?.val;
  const at = attrs?.find((a) => a.name === `${who}At`)?.val;
  return typeof actor === 'string' && typeof at === 'number' ? { actor, at } : null;
};
export const insertedBy = (map: ContentMap, client: number, clock: number): Authorship | null => read(map.inserts.slice(client, clock, 1)[0]?.attrs ?? null, 'insert');
export const deletedBy = (map: ContentMap, client: number, clock: number): Authorship | null => read(map.deletes.slice(client, clock, 1)[0]?.attrs ?? null, 'delete');

// Untrusted V1 update bytes from a replica, checked before they touch the authoritative doc (v14's getMissing,
// encoding.js, mirrored, plus the gap v14 would now integrate behind a Skip): they must decode; each client's structs
// continue from what the doc has; every left/right origin and ID parent exists in the doc (not in a skip) or the
// update, and an ID parent is a type; deletions name only clocks the doc or the update has.
export function checkV1(doc: Doc, update: Uint8Array): string | null {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch (error) {
    return `undecodable update (${error instanceof Error ? error.message : String(error)})`;
  }
  const store = doc.store;
  const reach = new Map<number, number>();
  const have = (client: number) => Math.max(reach.get(client) ?? 0, store.getClock(client));
  const items = new Map<number, Y.Item[]>();
  for (const struct of decoded.structs) {
    if (struct instanceof Y.Skip) return 'an update with a skip (a gap)';
    const { client, clock } = struct.id;
    if (clock > have(client)) return `a gap for client ${client} (clock ${clock}, have ${have(client)})`;
    reach.set(client, Math.max(have(client), clock + struct.length));
    if (struct instanceof Y.Item) items.set(client, [...(items.get(client) ?? []), struct]);
  }
  const exists = (id: Y.ID) => id.clock < have(id.client) && !store.skips.hasId(id);
  for (const struct of decoded.structs) {
    if (!(struct instanceof Y.Item)) continue;
    if (struct.origin && !exists(struct.origin)) return `an origin that does not exist (${struct.origin.client}:${struct.origin.clock})`;
    if (struct.rightOrigin && !exists(struct.rightOrigin)) return `a right origin that does not exist (${struct.rightOrigin.client}:${struct.rightOrigin.clock})`;
    const parent = struct.parent as unknown;
    if (parent instanceof Y.ID) {
      if (!exists(parent)) return `a parent that does not exist (${parent.client}:${parent.clock})`;
      const own = items.get(parent.client)?.find((i) => i.id.clock <= parent.clock && parent.clock < i.id.clock + i.length);
      const target = own ?? (parent.clock < store.getClock(parent.client) ? store.getItem(parent) : null);
      if (target instanceof Y.Item && !(target.content instanceof Y.ContentType)) return 'a parent that is not a type';
    }
  }
  let bad: string | null = null;
  decoded.ds.forEach((range, client) => {
    if (!bad && range.clock + range.len > have(client)) bad = `a deletion past clock ${have(client)} for client ${client}`;
  });
  return bad;
}

// After an apply: parked state, or a hole, means `checkV1` missed a case.
export const hasPending = (doc: Doc): boolean => doc.store.pendingStructs !== null || doc.store.pendingDs !== null || !doc.store.skips.isEmpty();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any node
export function idAt(type: Y.Node<any>, index: number): { client: number; clock: number } | null {
  const position = Y.createRelativePositionFromTypeIndex(type, index);
  return position.item ? { client: position.item.client, clock: position.item.clock } : null;
}
