// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11; parent §4.7 [binding], Decision Log 29): version
// history per slide, the pure half. Two deck states (a version and the one before it, two versions compared, or the live
// deck against the owner's last view) load into throwaway gc-off docs and v14's DiffRenderer, with the merged
// provenance between them, draws the later one: `slides.toDeltaDeep({renderer})` is the whole later deck with an
// `attribution` on exactly the leaves the window changed (a deleted element or slide comes back as content attributed
// `delete`). This walks that delta into a per-slide change set: slides added, removed and re-ordered, each slide's own
// keys, its elements (added, removed, or the keys and the text that changed), its notes' runs, the deck's own keys,
// every one with its author and time; "N changes" and the order ↑ ↓ visit them in. From P3-0's S6
// (`spikes/p3-store/s6/exp/provenance-v14.ts`), typed. No DOM; the editor draws what this computes (editor/history).
//
// S3's refinements (parent Decision Log 29) as they read on a deck: touching notes runs are one change; the keys of an
// element or a slide the diff inserts or deletes are not changes of their own (they came or went with it); an element
// counts once however many of its keys changed.
//
// S7a's pitfall 10 (the heavy deck's per-element count reading 0 after month one; the parent's Decision Log 36 and 37),
// reproduced on S7a's soak: by month two today's heavy deck keeps 1 slide id of the version's 100 (none at month three),
// so every change is a whole slide added or removed and 0 changed elements is the truth; the one kept slide was a
// restore's, re-created under its id, which S7a's walk skipped and `walkSlide` reads (history.test.ts states it).
import diff from 'fast-diff';
import { applyV2, deletedBy, insertedBy, type ContentMap, type Doc, type Node as YType } from '../yjs';
import { ContentType, createDiffRenderer, newDocGcOff, type DiffRenderer } from '../yjs/document';
import { DECK_ROOT, SLIDES_ROOT } from '../yjs/slides';
import { slideOrder } from './model';

/** Two throwaway gc-off docs (the earlier state, the later one) and the renderer that draws their difference. */
export interface DeckDiff {
  prevDoc: Doc;
  nextDoc: Doc;
  renderer: DiffRenderer;
  /** The provenance the renderer draws with (who removed what the renderer does not draw: `lastDeletion`). */
  attributions: ContentMap;
  destroy(): void;
}

/**
 * Loads two states into gc-off docs and builds the renderer; `prevState` null compares with nothing (the oldest
 * version: every slide reads as added). The live doc is never touched; the caller destroys the diff with its preview.
 */
export function openDeckDiff({ prevState, nextState, attributions }: { prevState: Uint8Array | null; nextState: Uint8Array; attributions: ContentMap }): DeckDiff {
  const prevDoc = newDocGcOff();
  if (prevState) applyV2(prevDoc, prevState);
  const nextDoc = newDocGcOff();
  applyV2(nextDoc, nextState);
  const renderer = createDiffRenderer(prevDoc, nextDoc, { attributions });
  return {
    prevDoc,
    nextDoc,
    renderer,
    attributions,
    destroy: () => {
      renderer.destroy();
      prevDoc.destroy();
      nextDoc.destroy();
    },
  };
}

/** Who did it (an actor key, X29's `actorKey`) and when (epoch ms, floored to the minute by the host). */
export interface Touch {
  by: string | null;
  at: number | null;
}

/** A key of a slide, an element or the deck the window set (`set`) or removed (`removed`). */
export interface KeyChange extends Touch {
  key: string;
  kind: 'set' | 'removed';
}

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface ElementChange extends Touch {
  id: string;
  kind: ChangeKind;
  /** The keys that changed (`style:*`, `attr:*`, `tag`, `parent`, `order`, `z`, `raw`, `text`); empty when added or removed. */
  keys: KeyChange[];
}

/** One piece of a notes run: inserted or deleted text, by whom. */
export interface NotesPart extends Touch {
  kind: 'ins' | 'del';
  text: string;
}
/** One change of a slide's notes: attributed pieces that touch, in order. */
export interface NotesRun {
  parts: NotesPart[];
}
/** A slide's notes as the preview shows them: unchanged text, inserts and deletions in order, each change with its run. */
export interface NotesPiece extends Touch {
  kind: 'same' | 'ins' | 'del';
  text: string;
  /** The run (`SlideChange.notes`' index) an insert or deletion belongs to; null for unchanged text. */
  run: number | null;
}

export interface SlideChange extends Touch {
  id: string;
  /** `changed` when the slide's own keys (order, background, hidden, transition) changed or anything in it did. */
  kind: ChangeKind;
  /** The slide's own keys that changed (one change however many); empty when added or removed. */
  keys: KeyChange[];
  /** In the shown slide's reading order, then the removed ones. */
  elements: ElementChange[];
  notes: NotesRun[];
  /** The whole notes with their changes in place, when the notes changed (else null: they read as they are). */
  notesPieces: NotesPiece[] | null;
}

export interface DeckChanges {
  /** The deck's own keys (title, cover, sections, faces, overrides, systems): one change; null when none changed. */
  deck: { keys: KeyChange[] } | null;
  /** Changed slides in the shown deck's order, a removed one at its earlier place. */
  slides: SlideChange[];
  /** "N changes": the deck, each slide added, removed or with its own keys changed, each element, each notes run. */
  count: number;
}

/** One stop of ↑ ↓, in the order they visit. */
export type ChangeStop = { part: 'deck'; slideId: null } | { part: 'slide'; slideId: string } | { part: 'element'; slideId: string; elementId: string } | { part: 'notes'; slideId: string; run: number };

// ---- the attributed delta

interface Attribution {
  insert?: unknown;
  insertAt?: unknown;
  delete?: unknown;
  deleteAt?: unknown;
  format?: unknown;
  formatAt?: unknown;
}
interface Op {
  type?: string;
  value?: unknown;
  insert?: unknown;
  attribution?: Attribution;
}
interface Delta {
  name?: string;
  attrs?: Record<string, Op>;
  children?: Op[];
}

const first = (ids: unknown): string | null => (Array.isArray(ids) && ids.length > 0 ? String(ids[0]) : typeof ids === 'string' ? ids : null);
const time = (at: unknown): number | null => (typeof at === 'number' ? at : null);
const isDelta = (v: unknown): v is Delta => typeof v === 'object' && v !== null && !Array.isArray(v) && ('attrs' in v || 'children' in v || 'name' in v);

/** What an attribution says: deleted, or inserted (set), with who and when. */
function touchOf(a: Attribution): Touch & { deleted: boolean } {
  if (a.delete !== undefined) return { deleted: true, by: first(a.delete), at: time(a.deleteAt) };
  if (a.insert !== undefined) return { deleted: false, by: first(a.insert), at: time(a.insertAt) };
  return { deleted: false, by: first(a.format), at: time(a.formatAt) };
}

/** The later of two touches (a missing time loses). */
const later = (a: Touch | null, b: Touch): Touch => (a === null || (b.at ?? -Infinity) > (a.at ?? -Infinity) ? { by: b.by, at: b.at } : a);

/** The latest attributed leaf anywhere inside a delta, or null when nothing inside changed. */
function latestIn(d: unknown): Touch | null {
  if (!isDelta(d)) return null;
  let found: Touch | null = null;
  const visit = (op: Op, value: unknown) => {
    if (op.attribution) found = later(found, touchOf(op.attribution));
    const inner = latestIn(value);
    if (inner) found = later(found, inner);
  };
  for (const op of Object.values(d.attrs ?? {})) visit(op, op.value);
  for (const op of d.children ?? []) {
    if (op.attribution) found = later(found, touchOf(op.attribution));
    if (Array.isArray(op.insert)) for (const child of op.insert) visit({}, child);
  }
  return found;
}

/** The keys of a node delta the window changed: an attributed value, or a nested node with a change inside. */
function changedKeys(d: Delta, skip: ReadonlySet<string>): KeyChange[] {
  const keys: KeyChange[] = [];
  for (const [key, op] of Object.entries(d.attrs ?? {})) {
    if (skip.has(key)) continue;
    if (op.attribution) {
      const t = touchOf(op.attribution);
      keys.push({ key, kind: t.deleted ? 'removed' : 'set', by: t.by, at: t.at });
      continue;
    }
    const inner = latestIn(op.value);
    if (inner) keys.push({ key, kind: 'set', ...inner });
  }
  return keys.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); // a doc's attribute order is not its history's
}

const latestOf = (touches: readonly Touch[]): Touch => touches.reduce<Touch | null>((a, b) => later(a, b), null) ?? { by: null, at: null };

const SLIDE_PARTS = new Set(['elements', 'notes']);
const NONE = new Set<string>();

/**
 * A slide present in both states, walked by element id. Presence decides added and removed (the id in each state);
 * attributions say what changed and who did it. A node new under an id the earlier state holds (a restore re-inserts
 * what it brings back as new items) is compared key by key with the earlier one: S7a's walk read such a node's
 * attribution as an insert and skipped its elements (its pitfall 10, with the heavy profile's slide churn; history.test.ts).
 */
function walkSlide(id: string, op: Op, prev: Doc, next: Doc, attributions: ContentMap): SlideChange | null {
  const d = isDelta(op.value) ? op.value : {};
  const keys = changedKeys(d, SLIDE_PARTS);
  const elements: ElementChange[] = [];
  const elementsOp = d.attrs?.elements;
  const shownOrder = readingOrder(next, id);
  const before = elementsNode(prev, id);
  const after = elementsNode(next, id);
  for (const [eid, eop] of Object.entries((isDelta(elementsOp?.value) ? elementsOp.value.attrs : undefined) ?? {})) {
    const change = walkElement(eid, eop, before, after);
    if (change) elements.push(change);
  }
  // removed in a way the renderer does not draw (brought back by a restore, then deleted again)
  for (const eid of attrIds(before)) {
    if (hasLive(after, eid) || elements.some((e) => e.id === eid)) continue;
    elements.push({ id: eid, kind: 'removed', keys: [], ...lastDeletion(after, eid, attributions) });
  }
  const rank = (e: ElementChange) => {
    const at = shownOrder.indexOf(e.id);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };
  elements.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const notesOp = d.attrs?.notes;
  const { runs: notes, pieces } = readNotesDelta(isDelta(notesOp?.value) ? notesOp.value : null);
  if (keys.length === 0 && elements.length === 0 && notes.length === 0) return null;
  const touches = [...keys, ...elements, ...notes.flatMap((r) => r.parts)];
  return { id, kind: 'changed', keys, elements, notes, notesPieces: notes.length ? pieces : null, ...latestOf(touches) };
}

function walkElement(id: string, op: Op, before: YType | null, after: YType | null): ElementChange | null {
  const inBefore = hasLive(before, id);
  const inAfter = hasLive(after, id);
  if (op.attribution) {
    const t = touchOf(op.attribution);
    if (t.deleted || !inAfter) return inBefore ? { id, kind: 'removed', keys: [], by: t.by, at: t.at } : null;
    if (!inBefore) return { id, kind: 'added', keys: [], by: t.by, at: t.at };
    // a new node under an id the earlier state holds: what differs, key by key, each credited by its own leaf
    const keys = replacedKeys(nodeOf(before, id)!, nodeOf(after, id)!, isDelta(op.value) ? op.value : undefined, t);
    return keys.length ? { id, kind: 'changed', keys, ...latestOf(keys) } : null;
  }
  const keys = changedKeys(isDelta(op.value) ? op.value : {}, NONE);
  if (keys.length === 0) return null;
  return { id, kind: 'changed', keys, ...latestOf(keys) };
}

// ---- notes

/** A notes node's delta as runs (touching attributed pieces merged) and as the whole text with its changes in place. */
function readNotesDelta(d: Delta | null): { runs: NotesRun[]; pieces: NotesPiece[] } {
  const runs: NotesRun[] = [];
  const pieces: NotesPiece[] = [];
  let open: NotesRun | null = null;
  for (const op of d?.children ?? []) {
    const text = typeof op.insert === 'string' ? op.insert : '';
    if (text === '') continue;
    if (!op.attribution) {
      open = null;
      pieces.push({ kind: 'same', text, by: null, at: null, run: null });
      continue;
    }
    const t = touchOf(op.attribution);
    const part: NotesPart = { kind: t.deleted ? 'del' : 'ins', text, by: t.by, at: t.at };
    if (open) open.parts.push(part);
    else runs.push((open = { parts: [part] }));
    pieces.push({ ...part, run: runs.length - 1 });
  }
  return { runs, pieces };
}

// ---- reading the states

function elementsNode(doc: Doc, slideId: string): YType | null {
  const slide = doc.get(SLIDES_ROOT).getAttr(slideId) as YType | undefined;
  return (slide?.getAttr('elements') as YType | undefined) ?? null;
}
const nodeOf = (elements: YType | null, id: string): YType | null => (elements?.getAttr(id) as YType | undefined) ?? null;
const hasLive = (elements: YType | null, id: string): boolean => nodeOf(elements, id) !== null;

/** The element ids of a slide in reading order: the model's flow and paint order (`readFlat`'s), by parent then key. */
function readingOrder(doc: Doc, slideId: string): string[] {
  const elements = elementsNode(doc, slideId);
  if (!elements) return [];
  const rows = [...(elements.attrEntries() as Iterable<[string, unknown]>)]
    .filter(([, v]) => v !== null && typeof v === 'object')
    .map(([id, node]) => {
      const n = node as YType;
      return { id, parent: String(n.getAttr('parent') ?? ''), key: String(n.getAttr('order') ?? n.getAttr('z') ?? '') };
    });
  const children = new Map<string, typeof rows>();
  for (const row of rows) children.set(row.parent, [...(children.get(row.parent) ?? []), row]);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (parent: string) => {
    for (const row of (children.get(parent) ?? []).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1))) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row.id);
      visit(row.id);
    }
  };
  visit('');
  for (const row of rows) if (!seen.has(row.id)) out.push(row.id); // a parent missing: after the rest
  return out;
}

/** The keys of two element nodes whose plain values differ, and `text` when their text does. */
function differingKeys(a: YType, b: YType): Omit<KeyChange, 'by' | 'at'>[] {
  const plain = (n: YType) => new Map([...(n.attrEntries() as Iterable<[string, unknown]>)].map(([k, v]) => [k, isNode(v) ? JSON.stringify((v as YType).toJSON()) : JSON.stringify(v)]));
  const [pa, pb] = [plain(a), plain(b)];
  const keys: Omit<KeyChange, 'by' | 'at'>[] = [];
  for (const key of new Set([...pa.keys(), ...pb.keys()])) {
    if (pa.get(key) === pb.get(key)) continue;
    keys.push({ key, kind: pb.has(key) ? 'set' : 'removed' });
  }
  return keys.sort((x, y) => (x.key < y.key ? -1 : 1));
}
const isNode = (v: unknown): boolean => typeof v === 'object' && v !== null && typeof (v as { toJSON?: unknown }).toJSON === 'function' && typeof (v as { getAttr?: unknown }).getAttr === 'function';

// ---- the whole deck

/** The per-slide change set of a diff: the deck's keys, then the slides in the shown deck's order. */
export function deckChanges(diff: Pick<DeckDiff, 'prevDoc' | 'nextDoc' | 'renderer' | 'attributions'>): DeckChanges {
  const { prevDoc, nextDoc, renderer } = diff;
  const slidesDelta = nextDoc.get(SLIDES_ROOT).toDeltaDeep({ renderer }).toJSON() as Delta;
  const deckDelta = nextDoc.get(DECK_ROOT).toDeltaDeep({ renderer }).toJSON() as Delta;
  const deckKeys = changedKeys(deckDelta, NONE);
  const before = new Set(slideIds(prevDoc));
  const after = new Set(slideIds(nextDoc));
  const changed: SlideChange[] = [];
  for (const [id, op] of Object.entries(slidesDelta.attrs ?? {})) {
    if (op.attribution && (!after.has(id) || !before.has(id))) {
      const t = touchOf(op.attribution);
      if (t.deleted || !after.has(id)) {
        if (before.has(id)) changed.push({ id, kind: 'removed', keys: [], elements: [], notes: [], notesPieces: null, by: t.by, at: t.at });
      } else changed.push({ id, kind: 'added', keys: [], elements: [], notes: [], notesPieces: null, by: t.by, at: t.at });
      continue;
    }
    if (!after.has(id)) continue;
    const change = op.attribution ? replacedSlide(id, op, prevDoc, nextDoc, diff.attributions) : walkSlide(id, op, prevDoc, nextDoc, diff.attributions);
    if (change) changed.push(change);
  }
  // removed in a way the renderer does not draw (brought back by a restore, then deleted again)
  for (const id of before) {
    if (after.has(id) || changed.some((s) => s.id === id)) continue;
    changed.push({ id, kind: 'removed', keys: [], elements: [], notes: [], notesPieces: null, ...lastDeletion(nextDoc.get(SLIDES_ROOT), id, diff.attributions) });
  }
  const slides = inShownOrder(changed, slideOrder(prevDoc), slideOrder(nextDoc));
  const deck = deckKeys.length ? { keys: deckKeys } : null;
  const count = (deck ? 1 : 0) + slides.reduce((n, s) => n + slideCount(s), 0);
  return { deck, slides, count };
}

/**
 * A slide node the later state holds as a new item under an id the earlier state holds (a restore bringing a deleted
 * slide back, a held slide cleared by a re-import): walked like any kept slide, every element and key compared by id.
 */
function replacedSlide(id: string, op: Op, prev: Doc, next: Doc, attributions: ContentMap): SlideChange | null {
  const t = touchOf(op.attribution!);
  const node: Touch = { by: t.by, at: t.at };
  const d = isDelta(op.value) ? op.value : undefined;
  const elementsDelta = isDelta(d?.attrs?.elements?.value) ? d.attrs.elements.value : undefined;
  const elements: ElementChange[] = [];
  const before = elementsNode(prev, id);
  const after = elementsNode(next, id);
  const ids = new Set([...attrIds(before), ...attrIds(after)]);
  for (const eid of ids) {
    const a = nodeOf(before, eid);
    const b = nodeOf(after, eid);
    const eop = elementsDelta?.attrs?.[eid];
    if (a && !b) {
      // not re-created, or re-created and deleted again: its last deleter when the later state holds the deletion
      const last = lastDeletion(after, eid, attributions);
      elements.push({ id: eid, kind: 'removed', keys: [], ...(last.by !== null ? last : node) });
    } else if (!a && b) {
      const added = eop?.attribution ? touchOf(eop.attribution) : node;
      elements.push({ id: eid, kind: 'added', keys: [], by: added.by, at: added.at });
    } else if (a && b) {
      const keys = replacedKeys(a, b, isDelta(eop?.value) ? eop.value : undefined, node);
      if (keys.length) elements.push({ id: eid, kind: 'changed', keys, ...latestOf(keys) });
    }
  }
  const order = readingOrder(next, id);
  const rank = (e: ElementChange) => (order.indexOf(e.id) < 0 ? Number.MAX_SAFE_INTEGER : order.indexOf(e.id));
  elements.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
  const slideKeys = replacedKeys(slideNode(prev, id)!, slideNode(next, id)!, d, node).filter((k) => !SLIDE_PARTS.has(k.key));
  const notesNode = (slideNode(next, id)?.getAttr('notes') as YType | undefined) ?? null;
  const { runs: notes, pieces } = rediffNotes(notesText(prev, id), notesNode, attributions, node);
  if (slideKeys.length === 0 && elements.length === 0 && notes.length === 0) return null;
  const touches = [...slideKeys, ...elements, ...notes.flatMap((r) => r.parts)];
  return { id, kind: 'changed', keys: slideKeys, elements, notes, notesPieces: notes.length ? pieces : null, ...latestOf(touches) };
}

/**
 * Fix wave 1 (R1): who set a key of a node as the later state holds it: the leaf's own attribution in the node's delta
 * (a restore's for what it re-created, a later writer's for what they changed on the restored node), the node's own
 * insertion only when the delta names none.
 */
function leafTouch(d: Delta | undefined, key: string, fallback: Touch): Touch {
  const op = d?.attrs?.[key];
  if (!op) return fallback;
  // fix wave 2: a nested node (an element's text) inserted by the restore and edited since is its latest edit's;
  // fix wave 3: provenance is floored to the minute, so on a tie a changed leaf by someone other than the node's
  // re-creator wins over the re-created structure
  const own = op.attribution ? touchOf(op.attribution) : null;
  const creator = own?.by ?? fallback.by;
  let best: Touch | null = own ? { by: own.by, at: own.at } : null;
  for (const t of touchesIn(op.value)) {
    const [at, bestAt] = [t.at ?? -Infinity, best?.at ?? -Infinity];
    if (best === null || at > bestAt || (at === bestAt && best.by === creator && t.by !== creator)) best = t;
  }
  return best ?? fallback;
}

/** Every attributed leaf inside a delta, in order. */
function touchesIn(d: unknown, out: Touch[] = []): Touch[] {
  if (!isDelta(d)) return out;
  for (const op of Object.values(d.attrs ?? {})) {
    if (op.attribution) out.push(pick(touchOf(op.attribution)));
    touchesIn(op.value, out);
  }
  for (const op of d.children ?? []) {
    if (op.attribution) out.push(pick(touchOf(op.attribution)));
    if (Array.isArray(op.insert)) for (const child of op.insert) touchesIn(child, out);
  }
  return out;
}
const pick = (t: Touch): Touch => ({ by: t.by, at: t.at });

/** The keys a node new under a kept id differs in from the earlier node, each credited by its leaf. */
const replacedKeys = (a: YType, b: YType, d: Delta | undefined, fallback: Touch): KeyChange[] => differingKeys(a, b).map((k) => ({ ...k, ...leafTouch(d, k.key, fallback) }));

// P3-E start (E1 M4 fix wave; the P3-E spec's Decision Log 30): one element's history between two places, for a kind whose
// element can change id and slide between the states (a design's element moved across boards, XE4). `inserted` is who
// put the shown element's node there (its own item's insertion in the window's provenance; the null touch when it was
// not inserted in the window), and `keys` what differs between the earlier element and the shown one, each credited by
// its own leaf exactly as a node re-created under a kept id is (`replacedKeys`, `leafTouch`: a later edit's author, the
// node's inserter otherwise, the same-minute rule unchanged). Additive: the deck's diff never calls it.
const slidesDeltas = new WeakMap<DiffRenderer, Delta>();
function slidesDeltaOf(diff: Pick<DeckDiff, 'nextDoc' | 'renderer'>): Delta {
  let d = slidesDeltas.get(diff.renderer);
  if (!d) slidesDeltas.set(diff.renderer, (d = diff.nextDoc.get(SLIDES_ROOT).toDeltaDeep({ renderer: diff.renderer }).toJSON() as Delta));
  return d;
}
export interface ElementPlace {
  slideId: string;
  elementId: string;
}
export function elementHistory(diff: Pick<DeckDiff, 'prevDoc' | 'nextDoc' | 'renderer' | 'attributions'>, earlier: ElementPlace, shown: ElementPlace): { inserted: Touch; keys: KeyChange[] } {
  const after = elementsNode(diff.nextDoc, shown.slideId);
  const node = nodeOf(after, shown.elementId);
  const item = after?._map.get(shown.elementId);
  const who = item && !item.deleted ? insertedBy(diff.attributions, item.id) : null;
  const slideOp = slidesDeltaOf(diff).attrs?.[shown.slideId];
  const slideDelta = isDelta(slideOp?.value) ? slideOp.value : undefined;
  const elementsOp = slideDelta?.attrs?.elements;
  const op = isDelta(elementsOp?.value) ? elementsOp.value.attrs?.[shown.elementId] : undefined;
  const fromOp = op?.attribution && !touchOf(op.attribution).deleted ? touchOf(op.attribution) : null;
  const inserted: Touch = who ? { by: who.actor, at: who.at } : fromOp ? { by: fromOp.by, at: fromOp.at } : { by: null, at: null };
  const before = nodeOf(elementsNode(diff.prevDoc, earlier.slideId), earlier.elementId);
  const keys = before && node ? replacedKeys(before, node, isDelta(op?.value) ? op.value : undefined, inserted) : [];
  return { inserted, keys };
}
// P3-E end

/**
 * Fix wave 1 (R1), fix wave 2: the notes of a slide node new under a kept id, compared with the earlier notes as text,
 * each change credited from the new node's own items. A character still there is an insert by whoever wrote it (the
 * restore, or a later writer); earlier text the new node lacks is a deletion by whoever deleted the new node's
 * characters at that place (the renderer draws none of them: inserted and deleted within the window), and, beyond
 * those, by the node's writer (the text went with the earlier node). Touching changes are one run.
 *
 * P3-F (L211): each deletion is credited by its own leaf, as a restored node's text is since fix wave 2: only a deleted
 * character the new node re-created stands for earlier text there. Re-created means written in the node's own
 * transaction, so under the node's clientID and credited to its writer and minute. A restore writes as its revert's
 * scratch doc (`revertUpdate`), a clientID of its own, so for a restore this is exact even when the restorer types in
 * the same minute: a character typed into the new node and taken back within the window credits nothing. A node
 * re-created by a clientID that types there again in the same minute (the editor's own undo of a slide's deletion)
 * leaves that typing indistinguishable from the re-creation in what history keeps (one actor, one minute, one clientID).
 */
function rediffNotes(earlier: string, notes: YType | null, attributions: ContentMap, node: Touch): { runs: NotesRun[]; pieces: NotesPiece[] } {
  const alive: { ch: string; by: string | null; at: number | null }[] = [];
  const gaps = new Map<number, Touch[]>(); // alive characters before → the re-created characters deleted there, one touch each
  const maker = notes?._item?.id.client; // L211: the clientID the new node was written under
  for (let item = notes?._start ?? null; item !== null; item = item.right) {
    if (item.content instanceof ContentType) continue;
    for (let i = 0; i < item.length; i++) {
      const id = { client: item.id.client, clock: item.id.clock + i };
      if (item.deleted) {
        if (id.client !== maker) continue; // L211: not re-created with the node (written under another clientID)
        const made = insertedBy(attributions, id);
        if (made && (made.actor !== node.by || made.at !== node.at)) continue; // nor by another writer or in another minute
        const who = deletedBy(attributions, id);
        const list = gaps.get(alive.length) ?? [];
        list.push({ by: who?.actor ?? node.by, at: who?.at ?? node.at });
        gaps.set(alive.length, list);
      } else {
        const who = insertedBy(attributions, id);
        alive.push({ ch: String((item.content.getContent() as unknown[]).join('')[i] ?? ''), by: who?.actor ?? node.by, at: who?.at ?? node.at });
      }
    }
  }
  const runs: NotesRun[] = [];
  const pieces: NotesPiece[] = [];
  let open: NotesRun | null = null;
  const part = (p: NotesPart) => {
    if (!open) runs.push((open = { parts: [] }));
    const last = open.parts.at(-1);
    if (last && last.kind === p.kind && last.by === p.by && last.at === p.at) last.text += p.text;
    else open.parts.push({ ...p });
    const shown = pieces.at(-1);
    if (shown && shown.kind === p.kind && shown.by === p.by && shown.at === p.at && shown.run === runs.length - 1) shown.text += p.text;
    else pieces.push({ ...p, run: runs.length - 1 });
  };
  let at = 0;
  for (const [op, chunk] of diff(earlier, alive.map((c) => c.ch).join(''))) {
    if (op === diff.EQUAL) {
      open = null;
      const last = pieces.at(-1);
      if (last?.kind === 'same') last.text += chunk;
      else pieces.push({ kind: 'same', text: chunk, by: null, at: null, run: null });
      at += chunk.length;
    } else if (op === diff.INSERT) {
      for (let i = 0; i < chunk.length; i++) part({ kind: 'ins', text: chunk[i]!, by: alive[at + i]!.by, at: alive[at + i]!.at });
      at += chunk.length;
    } else {
      const deleted = gaps.get(at) ?? [];
      for (let i = 0; i < chunk.length; i++) {
        const who = deleted.shift() ?? node;
        part({ kind: 'del', text: chunk[i]!, by: who.by, at: who.at });
      }
    }
  }
  return { runs, pieces };
}

/**
 * Who removed what the later state no longer holds, from its key's last item there: a key whose value was brought
 * back and deleted again within the window reads as deleted by the second deleter, and the renderer draws neither.
 */
function lastDeletion(container: YType | null, key: string, attributions: ContentMap): Touch {
  const item = container?._map.get(key);
  const who = item?.deleted ? deletedBy(attributions, item.id) : null;
  return { by: who?.actor ?? null, at: who?.at ?? null };
}

const slideNode = (doc: Doc, id: string): YType | null => (doc.get(SLIDES_ROOT).getAttr(id) as YType | undefined) ?? null;
const attrIds = (n: YType | null): string[] => (n ? [...(n.attrEntries() as Iterable<[string, unknown]>)].filter(([, v]) => isNode(v)).map(([k]) => k) : []);
function notesText(doc: Doc, id: string): string {
  const notes = slideNode(doc, id)?.getAttr('notes') as YType | undefined;
  if (!notes) return '';
  let text = '';
  for (let item = notes._start; item !== null; item = item.right) if (!item.deleted && !(item.content instanceof ContentType)) text += (item.content.getContent() as unknown[]).join('');
  return text;
}
const slideIds = (doc: Doc): string[] => [...(doc.get(SLIDES_ROOT).attrEntries() as Iterable<[string, unknown]>)].filter(([, v]) => isNode(v)).map(([k]) => k);

const slideCount = (s: SlideChange): number => (s.kind !== 'changed' ? 1 : (s.keys.length ? 1 : 0) + s.elements.length + s.notes.length);

/** The shown deck's order, each removed slide right after the slide before it in the earlier deck. */
function inShownOrder(changes: SlideChange[], before: string[], after: string[]): SlideChange[] {
  const order = [...after];
  for (const [i, id] of before.entries()) {
    if (order.includes(id)) continue;
    const prevKept = before.slice(0, i).reverse().find((s) => order.includes(s));
    order.splice(prevKept === undefined ? 0 : order.indexOf(prevKept) + 1, 0, id);
  }
  const rank = (id: string) => (order.indexOf(id) < 0 ? Number.MAX_SAFE_INTEGER : order.indexOf(id));
  return [...changes].sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : 1));
}

/** ↑ ↓'s stops: the deck, then per slide its own change, its elements in reading order, its notes runs. */
export function changeStops(changes: DeckChanges): ChangeStop[] {
  const stops: ChangeStop[] = [];
  if (changes.deck) stops.push({ part: 'deck', slideId: null });
  for (const s of changes.slides) {
    if (s.kind !== 'changed' || s.keys.length) stops.push({ part: 'slide', slideId: s.id });
    if (s.kind !== 'changed') continue;
    for (const e of s.elements) stops.push({ part: 'element', slideId: s.id, elementId: e.id });
    s.notes.forEach((_, run) => stops.push({ part: 'notes', slideId: s.id, run }));
  }
  return stops;
}

// ---- Show editors

/** One editor of an element: who, the latest time, and what they did (`attrs:<key>`, `text`, `del`). */
export interface ElementEditor {
  who: string;
  at: number;
  kinds: string[];
}

/**
 * Show editors of a live element (§4.7, Google Docs' "Show editors"): who set each of its keys still in force and who
 * typed or deleted its text, the latest time each, from provenance (so an edit older than a compaction is named too).
 * Newest first. Empty for an element the doc does not hold.
 */
export function elementEditors(doc: Doc, slideId: string, elementId: string, provenance: ContentMap): ElementEditor[] {
  const el = nodeOf(elementsNode(doc, slideId), elementId);
  if (!el) return [];
  const byWho = new Map<string, { at: number; kinds: Set<string> }>();
  const add = (attrs: readonly { name: string; val: unknown }[] | null | undefined, who: 'insert' | 'delete', kind: string) => {
    const actor = attrs?.find((a) => a.name === who)?.val;
    const at = attrs?.find((a) => a.name === `${who}At`)?.val;
    if (typeof actor !== 'string') return;
    const entry = byWho.get(actor) ?? { at: 0, kinds: new Set<string>() };
    entry.at = Math.max(entry.at, typeof at === 'number' ? at : 0);
    entry.kinds.add(kind);
    byWho.set(actor, entry);
  };
  const ranges = (map: ContentMap['inserts'], client: number, clock: number, length: number) => map.slice(client, clock, length) as { attrs?: { name: string; val: unknown }[] | null }[];
  // the element's keys in force: who set each
  for (const [key, item] of el._map) {
    if (item.deleted) continue;
    for (const r of ranges(provenance.inserts, item.id.client, item.id.clock, item.length)) add(r.attrs, 'insert', key === 'text' ? 'text' : `attrs:${key}`);
  }
  // its text: every character typed (still there) and every one deleted, block by block
  const text = el.getAttr('text') as YType | undefined;
  const walk = (n: YType) => {
    for (let item = n._start; item !== null; item = item.right) {
      if (item.deleted) for (const r of ranges(provenance.deletes, item.id.client, item.id.clock, item.length)) add(r.attrs, 'delete', 'text');
      else for (const r of ranges(provenance.inserts, item.id.client, item.id.clock, item.length)) add(r.attrs, 'insert', 'text');
      if (item.content instanceof ContentType) walk(item.content.type as YType);
    }
  };
  if (text) walk(text);
  return [...byWho].map(([who, { at, kinds }]) => ({ who, at, kinds: [...kinds].sort() })).sort((a, b) => b.at - a.at || (a.who < b.who ? -1 : 1));
}
