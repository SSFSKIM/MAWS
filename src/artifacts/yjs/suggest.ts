// The binding module: accepting and rejecting an artifact's suggestions (P3-A M8; its Decision Log 45, parent Decision
// Log 49). A suggestion is written into the artifact's suggestion doc (main doc + proposals, gc off) under its author's
// clientID, one transaction per write, so accepting one block of a write before the earlier ones would leave a gap in
// that clientID's clocks in the main doc, which the host refuses (Decision Log 17). The accepted result is therefore
// computed on scratch docs by v14's own `DiffRenderer.acceptChanges` and carried into the main doc as a content copy
// (`diffDocsToDelta`, applied as one transaction by the caller under a clientID it binds to the suggester), and the
// originals are then deleted in the suggestion doc. A rejected deletion is upstream's way: the deleted content comes
// back as a content-identical copy (v14's `rejectChanges`), since a CRDT deletion cannot be undone in place.
//
// Ranges are the item ids `@y/prosemirror` resolves an editor selection to (`relStart.item`, `relEnd.item`), the start
// and end `DiffRenderer.acceptChanges` takes: one parent's list from start to end, the whole subtree of an accepted
// inserted node with it. A range inside an inserted block that leaves the block out (S1's pitfall 7) leaves structs
// without their parent; the plan refuses it.
import * as delta from 'lib0/delta';
import * as encoding from 'lib0/encoding';
import * as Y from '@y/y';
import type { ContentIds, ContentMap, ItemId } from './attribution';
import type { Doc } from './doc';

export interface SuggestionRange {
  start: ItemId;
  end: ItemId;
}

// What accepting or rejecting changes, computed on scratch docs; nothing live is touched.
export interface SuggestionPlan {
  // The change to the main doc as one edit, to run inside a transaction on a replica of the main doc (empty: nothing).
  readonly edit: ((doc: Doc) => void) | null;
  // The suggestion doc's items to delete (accepted originals, rejected inserts), as a V1 update of deletions only.
  readonly remove: Uint8Array | null;
  // The suggestion doc's clientIDs whose proposals the accepted copy carries (their authors are credited).
  readonly suggesters: number[];
  // After `edit` ran on `result` (the replica, now holding the copy): the [from, to] pairs of each copied unit, from the
  // id it had (the original proposal, or for a rejected deletion the main doc's deleted content) to its copy's id, for
  // the provenance carry; null when the two docs' content cannot be paired unit by unit. Formatting markers a copy
  // placed differently (v14 merges a format run into an adjacent one) pair with a proposal's marker of the same format
  // when every such marker in the range is one proposer's; `complete` is false when some copied marker still pairs with
  // none, and it keeps the copy's binding.
  pairs(result: Doc): Pairs | null;
}

export interface Pairs {
  from: [number, number][];
  to: [number, number][];
  complete: boolean;
}

export class SuggestionError extends Error {
  readonly code = 'invalid';
  constructor(
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'SuggestionError';
  }
}

const scratch = (state: Uint8Array, suggestion = false): Y.Doc => {
  const doc = new Y.Doc({ gc: false, isSuggestionDoc: suggestion });
  Y.applyUpdateV2(doc, state);
  return doc;
};

// The accept of `ranges` in the suggestion doc (`suggestion`) over the main doc (`main`), with the suggestion doc's
// attributions (which content is a proposal and whose).
export function planAccept(main: Doc, suggestion: Doc, attributions: ContentMap, ranges: SuggestionRange[]): SuggestionPlan {
  const mainState = Y.encodeStateAsUpdateV2(main);
  const base = scratch(mainState); // the main doc as it is
  const prev = scratch(mainState); // the main doc as the accept leaves it
  try {
    const accepted = collect(prev, suggestion, attributions, ranges);
    if (prev.store.pendingStructs !== null || prev.store.pendingDs !== null) {
      throw new SuggestionError('a range leaves part of an inserted block without the block: pass the block’s own range', { reason: 'partialBlock' });
    }
    const roots = [...(Y.diffDocsToDelta(base, prev) as unknown as Delta).attrs].flatMap((op): [string, delta.DeltaBuilderAny][] => {
      const change = delta.$modifyAttrOp.check(op) ? applicable(op.value as Delta) : null;
      return change ? [[String(op.key), change]] : [];
    });
    // What the main doc loses (content of its own a proposal deleted) is applied by id, before the delta.
    const gone = Y.intersectSets(Y.diffIdSet(Y.createDeleteSetFromStructStore(prev.store), Y.createDeleteSetFromStructStore(base.store)), Y.createInsertSetFromStructStore(base.store, false));
    const deletions = gone.isEmpty() ? null : deletionsOf(gone);
    // The originals taken (proposals, and proposals already withdrawn that came along), deleted in the suggestion doc.
    const taken = Y.diffIdSet(accepted?.inserts ?? Y.createIdSet(), Y.createInsertSetFromStructStore(main.store, false));
    const acceptedState = Y.encodeStateAsUpdateV2(prev);
    const edit =
      roots.length === 0 && !deletions
        ? null
        : (doc: Doc) => {
            if (deletions) Y.applyUpdate(doc, deletions);
            for (const [name, change] of roots) doc.get(name).applyDelta(change);
          };
    return {
      edit,
      remove: taken.isEmpty() ? null : deletionsOf(taken),
      suggesters: [...taken.clients.keys()],
      // The accepted state (the main doc with the originals) against the copy: equal unit by unit, ids differing where
      // copied.
      pairs: (result) => paired(acceptedState, result, taken),
    };
  } finally {
    base.destroy();
    prev.destroy();
  }
}

// The reject of `ranges`: proposed content still standing in the suggestion doc is deleted there, and content of the
// main doc a proposal deleted comes back as a content-identical copy (deleted and redone on a scratch copy of the main
// doc, so every reference is the main doc's own), since a deletion cannot be undone in place. What the ranges cover is
// what an accept of them would take. A proposal withdrawn earlier is never brought back.
export function planReject(main: Doc, suggestion: Doc, attributions: ContentMap, ranges: SuggestionRange[]): SuggestionPlan {
  const mainState = Y.encodeStateAsUpdateV2(main);
  const prev = scratch(mainState);
  let covered: ContentIds | null;
  try {
    covered = collect(prev, suggestion, attributions, ranges);
  } finally {
    prev.destroy();
  }
  const mainInserts = Y.createInsertSetFromStructStore(main.store, false);
  const proposed = Y.diffIdSet(Y.diffIdSet(covered?.inserts ?? Y.createIdSet(), mainInserts), Y.createDeleteSetFromStructStore(suggestion.store));
  const restore = Y.diffIdSet(Y.intersectSets(covered?.deletes ?? Y.createIdSet(), mainInserts), Y.createDeleteSetFromStructStore(main.store));
  let copy: Uint8Array | null = null;
  if (!restore.isEmpty()) {
    const redo = scratch(mainState);
    // Above every clientID either doc holds: a restored attribute is concurrent with the proposal that replaced it, and
    // v14 keeps the higher clientID's on the right, so the restored value stays once the proposal is removed.
    redo.clientID = clientAbove([main, suggestion]);
    try {
      redo.on('update', (u: Uint8Array) => {
        copy = copy ? Y.mergeUpdates([copy as Uint8Array<ArrayBuffer>, u as Uint8Array<ArrayBuffer>]) : u;
      });
      Y.applyUpdate(redo, deletionsOf(restore));
      const undo = new Y.UndoManager(redo);
      undo.undoStack.push({ inserts: Y.createIdSet(), deletes: restore, meta: new Map() });
      undo.undo();
      undo.destroy();
    } finally {
      redo.destroy();
    }
  }
  const update = copy as Uint8Array | null;
  return {
    edit: update ? (doc) => Y.applyUpdate(doc, update) : null,
    remove: proposed.isEmpty() ? null : deletionsOf(proposed),
    suggesters: [],
    // The main doc before (the deleted content still there) against the copy.
    pairs: (result) => paired(mainState, result),
  };
}

// What `ranges` cover, as v14's own accept walks them (`DiffRenderer.acceptChanges` over a scratch copy of the
// suggestion doc), applied to `prev` (a scratch copy of the main doc); answers the ids it took, or null for none.
function collect(prev: Y.Doc, suggestion: Doc, attributions: ContentMap, ranges: SuggestionRange[]): ContentIds | null {
  const next = scratch(Y.encodeStateAsUpdateV2(suggestion), true);
  const renderer = Y.createDiffRenderer(prev, next, { attributions });
  let accepted: Uint8Array | null = null;
  prev.on('update', (u: Uint8Array) => {
    accepted = accepted ? Y.mergeUpdates([accepted as Uint8Array<ArrayBuffer>, u as Uint8Array<ArrayBuffer>]) : u;
  });
  try {
    for (const range of ranges) {
      for (const id of [range.start, range.end]) {
        if (id.clock >= next.store.getClock(id.client)) throw new SuggestionError(`no content at ${id.client}:${id.clock} in the suggestions`, { range });
      }
      if (!onOneChain(next, range)) throw new SuggestionError('a range’s end is not on its start’s item chain (one parent, start before end)', { range, reason: 'range' });
      renderer.acceptChanges(Y.createID(range.start.client, range.start.clock), Y.createID(range.end.client, range.end.clock));
    }
  } finally {
    renderer.destroy();
    next.destroy();
  }
  const taken = accepted as Uint8Array | null;
  return taken ? Y.createContentIdsFromUpdate(taken) : null;
}

// Whether `range.end` lies on `range.start`'s item chain at or after it: the same parent (and the same attribute key),
// reachable by walking right, as v14's accept walks.
function onOneChain(doc: Y.Doc, range: SuggestionRange): boolean {
  const start = doc.store.getItem(Y.createID(range.start.client, range.start.clock));
  const end = doc.store.getItem(Y.createID(range.end.client, range.end.clock));
  if (!(start instanceof Y.Item) || !(end instanceof Y.Item)) return false;
  if (start.parent !== end.parent || start.parentSub !== end.parentSub) return false;
  for (let item: Y.Item | null = start; item !== null; item = item.right as Y.Item | null) if (item === end) return true;
  return false;
}

// `proposals`: the ids a formatting marker of the copy may be credited from when it cannot be paired in place.
function paired(state: Uint8Array, result: Doc, proposals?: Y.IdSet): Pairs | null {
  const reference = scratch(state);
  try {
    return pairUnits(reference, result, proposals);
  } finally {
    reference.destroy();
  }
}

// The ops of a rendered delta as this module reads them (lib0's op classes, structurally).
interface Op {
  key?: string | number;
  value?: unknown;
  insert?: unknown;
  retain?: number;
  delete?: number;
  format?: Record<string, unknown> | null;
  attribution?: { delete?: unknown } | null;
  next: Op | null;
}
interface Delta {
  name: string | null;
  attrs: Iterable<Op>;
  children: { start: Op | null };
}

// `diffDocsToDelta` renders a diff for display: content the newer doc deleted stays in it (a retain, an attribute set or
// a node modify carrying a `delete` attribution), whether the older doc had it or it was inserted and deleted on the
// way, and the rendering does not say which. The deletions are therefore applied by id before the delta (`plan`), and
// every deleted op is dropped here, so the delta's positions count live content only, as `applyDelta` does. Null when
// nothing is left to change.
function applicable(rendered: Delta): delta.DeltaBuilderAny | null {
  const out = delta.create(rendered.name) as delta.DeltaBuilderAny;
  let changed = false;
  for (const op of rendered.attrs) {
    if (op.attribution?.delete !== undefined || delta.$deleteAttrOp.check(op)) continue; // deleted by id
    if (delta.$modifyAttrOp.check(op)) {
      const inner = applicable(op.value as Delta);
      if (inner) out.modifyAttr(op.key as string, inner);
      changed ||= inner !== null;
      continue;
    }
    out.setAttr(op.key as string, op.value);
    changed = true;
  }
  let retained = 0; // retains that change nothing are written only before a change
  for (let op = rendered.children.start; op !== null; op = op.next) {
    if (op.attribution?.delete !== undefined || delta.$deleteOp.check(op)) continue; // deleted by id
    const inner = delta.$modifyOp.check(op) ? applicable(op.value as Delta) : null;
    if ((delta.$retainOp.check(op) || delta.$modifyOp.check(op)) && !inner && !op.format) {
      retained += delta.$retainOp.check(op) ? op.retain! : 1;
      continue;
    }
    if (retained > 0) out.retain(retained);
    retained = 0;
    if (delta.$retainOp.check(op)) out.retain(op.retain!, op.format ?? undefined);
    else if (delta.$modifyOp.check(op)) out.modify(inner ?? delta.create((op.value as Delta).name), op.format ?? undefined);
    else out.insert(op.insert as string, op.format ?? undefined);
    changed = true;
  }
  return changed ? out : null;
}

// A V1 update that deletes exactly `ids` and inserts nothing.
export function deletionsOf(ids: Y.IdSet): Uint8Array {
  const encoder = new Y.UpdateEncoderV1();
  encoding.writeVarUint(encoder.restEncoder, 0); // no structs
  Y.writeIdSet(encoder, ids);
  return encoder.toUint8Array();
}

// The ids an update deletes (what a removal took out of the suggestion doc).
export const deletedIds = (v1: Uint8Array): ContentIds['deletes'] => Y.createContentIdsFromUpdate(v1).deletes;

// A clientID above every clientID `docs` hold. A copied map attribute lands where it is concurrent with its original in
// the suggestion doc (both set over the same value); v14 keeps the higher clientID's on the right, so the copy stays
// the key's value there once the original is deleted.
export function clientAbove(docs: Doc[]): number {
  let max = 0;
  for (const doc of docs) for (const client of doc.store.clients.keys()) max = Math.max(max, client);
  const id = max + 1;
  if (!Number.isSafeInteger(id)) throw new Error('no clientID above the document’s is left');
  return id;
}

type Unit = { kind: string; id: [number, number] };

// Every content unit of every root type in document order (attributes by key, then children; a string's characters
// one by one), each with its id; the formatting markers in a list of their own, since a copy may place them
// differently while its content is the same.
function unitsOf(doc: Y.Doc, names: string[]): { out: Unit[]; formats: Unit[] } {
  const out: Unit[] = [];
  const formats: Unit[] = [];
  const walk = (node: Y.Node) => {
    for (const key of [...node._map.keys()].sort()) {
      const item = node._map.get(key)!;
      if (item.deleted) continue;
      out.push({ kind: `@${key}`, id: [item.id.client, item.id.clock] });
      if (item.content instanceof Y.ContentType) walk(item.content.type as Y.Node);
    }
    for (let item: Y.Item | null = node._start; item !== null; item = item.right as Y.Item | null) {
      if (item.deleted) continue;
      const content = item.content;
      if (content instanceof Y.ContentFormat) {
        formats.push({ kind: `${content.key}=${JSON.stringify(content.value)}`, id: [item.id.client, item.id.clock] });
        continue;
      }
      if (content instanceof Y.ContentType) {
        out.push({ kind: `<${(content.type as Y.Node).name ?? ''}`, id: [item.id.client, item.id.clock] });
        walk(content.type as Y.Node);
      } else if (content instanceof Y.ContentString) {
        for (let i = 0; i < item.length; i++) out.push({ kind: `"${content.str[i]}`, id: [item.id.client, item.id.clock + i] });
      } else {
        for (let i = 0; i < item.length; i++) out.push({ kind: '*', id: [item.id.client, item.id.clock + i] });
      }
    }
  };
  for (const name of names) {
    const root = doc.share.get(name);
    if (root) walk(root as Y.Node);
  }
  return { out, formats };
}

function pairUnits(reference: Y.Doc, result: Y.Doc, proposals?: Y.IdSet): Pairs | null {
  const names = [...new Set([...reference.share.keys(), ...result.share.keys()])].sort();
  const a = unitsOf(reference, names);
  const b = unitsOf(result, names);
  const content = pairLists(a.out, b.out);
  if (!content) return null;
  const formats = pairLists(a.formats, b.formats) ?? (proposals ? bySource(a.formats, b.formats, proposals) : null);
  if (!formats) return { ...content, complete: false };
  return { from: [...content.from, ...formats.from], to: [...content.to, ...formats.to], complete: formats.complete ?? true };
}

// The copy's own formatting markers (those the reference does not hold) when the copy placed them differently: each
// pairs with a proposal's marker of the same format (key and value, else key), provided every such proposal marker is
// under one clientID, so its author is the one who set that format. A marker with no such source stays unpaired.
function bySource(a: Unit[], b: Unit[], proposals: Y.IdSet): { from: [number, number][]; to: [number, number][]; complete: boolean } {
  const idKey = ([client, clock]: [number, number]) => `${client}:${clock}`;
  const inReference = new Set(a.map((u) => idKey(u.id)));
  const sources = a.filter((u) => proposals.has(u.id[0], u.id[1]));
  const formatKey = (kind: string) => kind.slice(0, kind.indexOf('='));
  const from: [number, number][] = [];
  const to: [number, number][] = [];
  let complete = true;
  for (const copy of b.filter((u) => !inReference.has(idKey(u.id)))) {
    let candidates = sources.filter((u) => u.kind === copy.kind);
    if (candidates.length === 0) candidates = sources.filter((u) => formatKey(u.kind) === formatKey(copy.kind));
    if (candidates.length > 0 && candidates.every((u) => u.id[0] === candidates[0].id[0])) {
      from.push(candidates[0].id);
      to.push(copy.id);
    } else {
      complete = false;
    }
  }
  return { from, to, complete };
}

function pairLists(a: Unit[], b: Unit[]): { from: [number, number][]; to: [number, number][]; complete?: boolean } | null {
  if (a.length !== b.length) return null;
  const from: [number, number][] = [];
  const to: [number, number][] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].kind !== b[i].kind) return null;
    if (a[i].id[0] === b[i].id[0] && a[i].id[1] === b[i].id[1]) continue;
    from.push(a[i].id);
    to.push(b[i].id);
  }
  return { from, to };
}
