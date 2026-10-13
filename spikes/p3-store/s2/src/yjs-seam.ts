// S2 (P3-0, docs/doperpowers/plans/2026-10-12-p3-co-work.md): the one module that calls Yjs for the host's document
// service and the port provider. Everything above it speaks in docs, update bytes, state vectors and clock ranges, so a
// Yjs v14 swap (S1) is this file plus the provider's Awareness import.
//
// v14 notes (source, not run): the package is `@y/y`; `Doc`, `applyUpdate(V2)`, `encodeStateAsUpdate(V2)`,
// `encodeStateVector` keep their names; the delete set becomes an IdSet (`decodeUpdate(...).ds` is replaced by the
// IdSet readers), and attribution moves to an IdMap built by the receiver, which is what `factsOf` hand-rolls here.
import * as Y from 'yjs';

export type Doc = Y.Doc;
export type ClockRange = { client: number; clockStart: number; clockEnd: number }; // [clockStart, clockEnd)
export interface UpdateFacts {
  inserts: ClockRange[]; // structs the update adds, merged per client
  deletes: ClockRange[]; // the update's delete set
}

export const newDoc = (): Doc => new Y.Doc({ gc: true });
export const clientIdOf = (doc: Doc): number => doc.clientID;

// The wire (y-protocols 1.x) carries V1 updates, and so does the log; version states are V2 (smaller).
export const stateVector = (doc: Doc): Uint8Array => Y.encodeStateVector(doc);
export const diffV1 = (doc: Doc, sv?: Uint8Array): Uint8Array => Y.encodeStateAsUpdate(doc, sv);
export const stateV2 = (doc: Doc): Uint8Array => Y.encodeStateAsUpdateV2(doc);
export const applyV1 = (doc: Doc, update: Uint8Array, origin: unknown): void => Y.applyUpdate(doc, update, origin);
export const applyV2 = (doc: Doc, update: Uint8Array, origin: unknown): void => Y.applyUpdateV2(doc, update, origin);
export const svOf = (doc: Doc): Map<number, number> => Y.decodeStateVector(Y.encodeStateVector(doc));
export const decodeSv = (sv: Uint8Array): Map<number, number> => Y.decodeStateVector(sv);

// The host doc's integrated changes as V1 bytes (what the wire carries and the log stores), with the transaction's
// origin. One encoding end to end costs no conversion per keystroke; versions are V2 states.
export function onIntegrated(doc: Doc, listener: (update: Uint8Array, origin: unknown) => void): void {
  doc.on('update', (update: Uint8Array, origin: unknown) => listener(update, origin));
}

// What an integrated update adds and deletes, for provenance (X29). Skip structs carry nothing.
export function factsOf(update: Uint8Array): UpdateFacts {
  const { structs, ds } = Y.decodeUpdate(update);
  const inserts: ClockRange[] = [];
  for (const struct of structs) {
    if (struct instanceof Y.Skip) continue;
    const last = inserts[inserts.length - 1];
    const { client, clock } = struct.id;
    if (last && last.client === client && last.clockEnd === clock) last.clockEnd = clock + struct.length;
    else inserts.push({ client, clockStart: clock, clockEnd: clock + struct.length });
  }
  const deletes: ClockRange[] = [];
  ds.clients.forEach((items, client) => {
    for (const item of items) deletes.push({ client, clockStart: item.clock, clockEnd: item.clock + item.len });
  });
  return { inserts, deletes };
}

// Untrusted V1 update bytes from a replica, checked before they touch the authoritative doc. They must decode; each
// client's structs must continue from what the doc has (no gap); every reference an item makes (left and right
// origin, an ID parent) must exist in the doc or the update, and an ID parent must be a type; deletions may name only
// clocks the doc or the update has. Yjs would otherwise park the struct or the deletion as pending, in memory and
// outside the log, where an ack would lie (Item.getMissing is the rule mirrored here). `hasPending` after the apply is
// the safety net for whatever this misses (a forged reference cycle across clients, say).
export function checkV1(doc: Doc, update: Uint8Array): string | null {
  let decoded: ReturnType<typeof Y.decodeUpdate>;
  try {
    decoded = Y.decodeUpdate(update);
  } catch (error) {
    return `undecodable update (${error instanceof Error ? error.message : String(error)})`;
  }
  const store = doc.store;
  // Pass 1: per client, the clock the doc plus the update reach; a gap is refused here.
  const reach = new Map<number, number>();
  const have = (client: number) => Math.max(reach.get(client) ?? 0, Y.getState(store, client));
  const items = new Map<number, Y.Item[]>(); // the update's own items, for parents created in the same update
  for (const struct of decoded.structs) {
    if (struct instanceof Y.Skip) return 'an update with a skip (a gap)';
    const { client, clock } = struct.id;
    if (clock > have(client)) return `a gap for client ${client} (clock ${clock}, have ${have(client)})`;
    reach.set(client, Math.max(have(client), clock + struct.length));
    if (struct instanceof Y.Item) items.set(client, [...(items.get(client) ?? []), struct]);
  }
  // Pass 2: references, against everything the update brings (Yjs encodes clients in descending order, so an origin
  // may sit in a later block of the same update).
  const exists = (id: Y.ID) => id.clock < have(id.client);
  for (const struct of decoded.structs) {
    if (!(struct instanceof Y.Item)) continue;
    if (struct.origin && !exists(struct.origin)) return `an origin that does not exist (${struct.origin.client}:${struct.origin.clock})`;
    if (struct.rightOrigin && !exists(struct.rightOrigin)) return `a right origin that does not exist (${struct.rightOrigin.client}:${struct.rightOrigin.clock})`;
    const parent = struct.parent as unknown;
    if (parent instanceof Y.ID) {
      if (!exists(parent)) return `a parent that does not exist (${parent.client}:${parent.clock})`;
      const own = items.get(parent.client)?.find((i) => i.id.clock <= parent.clock && parent.clock < i.id.clock + i.length);
      const target = own ?? (parent.clock < Y.getState(store, parent.client) ? Y.getItem(store, parent) : null);
      if (target instanceof Y.Item && !(target.content instanceof Y.ContentType)) return 'a parent that is not a type';
    }
  }
  for (const [client, deleted] of decoded.ds.clients) {
    for (const item of deleted) if (item.clock + item.len > have(client)) return `a deletion past clock ${have(client)} for client ${client}`;
  }
  return null;
}

// After an apply: anything Yjs still holds as pending means `checkV1` missed a case.
export const hasPending = (doc: Doc): boolean => doc.store.pendingStructs !== null || doc.store.pendingDs !== null;

// Who wrote the character at `index` of a text: the ID Yjs gives a relative position at that index.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any shared type (Text, XmlText, Array)
export function idAt(type: Y.AbstractType<any>, index: number): { client: number; clock: number } | null {
  const position = Y.createRelativePositionFromTypeIndex(type, index);
  return position.item ? { client: position.item.client, clock: position.item.clock } : null;
}
