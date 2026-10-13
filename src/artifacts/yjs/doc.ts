// The binding module (X24, Decision Log 25 of docs/doperpowers/plans/2026-10-12-p3-co-work.md): every Yjs call MAWS
// makes outside the port provider's awareness import goes through `src/artifacts/yjs/`, so a re-pin of `@y/y` or
// `@y/prosemirror` edits this directory (and `pnpm-workspace.yaml`'s overrides) and nothing else. This file: docs,
// the wire and log encoding (V1), the version encoding (V2), the binding version every stored document records, and
// the predicate B's editor needs to tell the binding's own ProseMirror transactions apart.
import * as Y from '@y/y';

export type Doc = Y.Doc;
// A shared type of v14's unified model: `doc.get(name)` is one, with attributes (`setAttr`), text and child nodes.
export type Node = Y.Node;

// The pins a stored document was written under (`artifacts.bindingVersion`): `@y/y` 14.0.0-rc.28 and `@y/prosemirror`
// 2.0.0-15. A prerelease change to the ProseMirror mapping means normalizing the documents tagged with the old value.
export const bindingVersion = 'y14-rc28/ypm2-15';

// gc on: deleted content is collected, versions are full states (no state-pair snapshots).
export const newDoc = (): Doc => new Y.Doc({ gc: true });

// The wire (y-protocols sync) and the update log carry V1; version states are V2, which is smaller.
export const stateVector = (doc: Doc): Uint8Array => Y.encodeStateVector(doc);
export const diffV1 = (doc: Doc, sv?: Uint8Array): Uint8Array => Y.encodeStateAsUpdate(doc, sv);
export const applyV1 = (doc: Doc, update: Uint8Array, origin?: unknown): void => Y.applyUpdate(doc, update, origin);
// Several V1 updates as one, applied in one transaction (the provider's release of a composition hold).
// (The rc types it for `ArrayBuffer`-backed arrays only; a frame's payload is a structured-clone copy, never shared.)
export const mergeUpdates = (updates: Uint8Array[]): Uint8Array => Y.mergeUpdates(updates as Uint8Array<ArrayBuffer>[]);
export const stateV2 = (doc: Doc): Uint8Array => Y.encodeStateAsUpdateV2(doc);
export const applyV2 = (doc: Doc, state: Uint8Array, origin?: unknown): void => Y.applyUpdateV2(doc, state, origin);

// Runs `edit` as one transaction (one update, one log row) with `origin` as the transaction's origin.
export const transact = (doc: Doc, edit: () => void, origin?: unknown): void => doc.transact(edit, origin);

// Every integrated change as the V1 update it produced, with its transaction's origin; returns the unsubscribe.
export function onUpdate(doc: Doc, listener: (update: Uint8Array, origin: unknown) => void): () => void {
  const handler = (update: Uint8Array, origin: unknown) => listener(update, origin);
  doc.on('update', handler);
  return () => doc.off('update', handler);
}

// True for a ProseMirror transaction `@y/prosemirror`'s binding dispatched (a remote change, its own fix-ups, a
// reconfiguration) rather than the user. v14's UniqueID and the core Delete extension must skip these in their
// `filterTransaction`/`appendTransaction`, or they write into blocks a remote replica owns (Decision Log 25's first
// pitfall). The three metas are the ones `@y/prosemirror`'s own undo plugin reads (`undo-plugin.js`, `isSyncOrigin`);
// `'y-sync$'` is the key string of its `ySyncPluginKey`. Typed structurally so this module needs no ProseMirror import.
export function isBindingTransaction(tr: { getMeta(key: string): unknown }): boolean {
  return tr.getMeta('y-sync-transaction') != null || tr.getMeta('y-sync-append') != null || tr.getMeta('y-sync$') != null;
}
