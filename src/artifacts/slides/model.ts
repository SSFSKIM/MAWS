// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D2, D5, D8), from S6's `spikes/p3-store/s6/src/model.ts`.
// The deck model in IR terms: a slide's element tree flattened to id-keyed records with a `parent` and a sibling key,
// read back into a tree with deterministic rules for the states concurrency can produce (an orphan whose parent was
// deleted, a parent cycle, equal keys); the deck's files as `artifact_read` returns them; the host's repair; object
// anchors; and the editor's writers, one gesture one transaction with the caller's origin. Yjs only through the seam.
import { transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { DECK_PATH, serializeDeckJson, slidePath, type DeckFace, type DeckJson, type DeckSection } from './deck';
import { CELL_TAGS, CONTAINER_TAGS, TEXT_TAGS, isPinned, type Attrs, type ElementIR, type SlideIR, type Style, type Tag, type TextBlock } from './ir';
import { ANY, FLOW_LAYER, OVER, UNDER, byKey, keyAfter, rekey, repairCollisions, type Bounds } from './order';
import { hash4, ID_RE } from './parse';
import { partition, serializeSlide } from './serialize';

export const ROOT = ''; // the parent value of a section's direct children; as an element id, the section itself

/** One element as the model holds it. `order` places a flow child among its siblings; `z` places a pinned one. */
export interface FlatElement {
  id: string;
  tag: Tag;
  parent: string;
  order?: string;
  z?: string;
  style: Style;
  attrs: Attrs;
  text?: TextBlock[];
  raw?: string;
}

export type Group = 'under' | 'flow' | 'over';
export const GROUPS: readonly Group[] = ['under', 'flow', 'over'];
export const GROUP_BOUNDS: Record<Group, Bounds> = { under: UNDER, flow: ANY, over: OVER };
export const groupKey = (g: Group): 'order' | 'z' => (g === 'flow' ? 'order' : 'z');

/** Which sibling list an element is in, from its own state (pinned-ness and its z against the flow layer). */
export function groupOf(e: Pick<FlatElement, 'tag' | 'style' | 'attrs' | 'z'>): Group {
  if (!isPinned(e.tag, e.style, e.attrs)) return 'flow';
  return e.z !== undefined && e.z < FLOW_LAYER ? 'under' : 'over';
}

// ---------------------------------------------------------------- scalars <-> FlatElement

export function toScalars(e: FlatElement): Y.Scalars {
  const s: Y.Scalars = { tag: e.tag, parent: e.parent };
  if (e.order !== undefined) s.order = e.order;
  if (e.z !== undefined) s.z = e.z;
  for (const [k, v] of Object.entries(e.style)) s[`style:${k}`] = v;
  for (const [k, v] of Object.entries(e.attrs)) s[`attr:${k}`] = v;
  if (e.raw !== undefined) s.raw = e.raw;
  return s;
}
export function fromScalars(id: string, s: Y.Scalars): FlatElement {
  const e: FlatElement = { id, tag: s.tag as Tag, parent: typeof s.parent === 'string' ? s.parent : ROOT, style: {}, attrs: {} };
  if (typeof s.order === 'string') e.order = s.order;
  if (typeof s.z === 'string') e.z = s.z;
  if (typeof s.raw === 'string') e.raw = s.raw;
  for (const [k, v] of Object.entries(s)) {
    if (k.startsWith('style:')) e.style[k.slice(6)] = v as string;
    else if (k.startsWith('attr:')) e.attrs[k.slice(5)] = v as string;
  }
  return e;
}
export function slideScalarsOf(ir: Pick<SlideIR, 'style' | 'attrs'>): Y.Scalars {
  const s: Y.Scalars = {};
  for (const [k, v] of Object.entries(ir.style)) s[`style:${k}`] = v;
  for (const [k, v] of Object.entries(ir.attrs)) s[`attr:${k}`] = v;
  return s;
}

// ---------------------------------------------------------------- ids the model mints

/**
 * Table cells are positional in the files (D2, S6 question 1); the model gives each an id of its row's id, `/`, and a
 * token of the writing replica's clientID and a counter. `/` is outside the id grammar, so a cell id never meets an
 * element id, and the clientID keeps two replicas adding cells at once from minting the same one.
 */
export function cellMinter(doc: Doc, taken: Iterable<string>): (rowId: string) => string {
  const used = new Set(taken);
  const token = doc.clientID.toString(36);
  let n = 0;
  return (rowId) => {
    let id: string;
    do id = `${rowId}/${token}.${n++}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
}

/** An element id for a copy (`e<n>-<hash>`, D4's form), never one in `taken`. */
export function elementMinter(doc: Doc, slideId: string, taken: Iterable<string>): (seed: string) => string {
  const used = new Set(taken);
  let n = 0;
  return (seed) => {
    const h = hash4(`${slideId}\u0000${seed}\u0000${doc.clientID}`);
    let id: string;
    do id = `e${++n}-${h}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
}

// ---------------------------------------------------------------- IR -> flat

/**
 * The IR's tree as flat records with fresh keys, in the canonical order ([under] [flow] [over] per parent). A cell's
 * id is its IR id when it has one, else `cellId(rowId, index)`.
 */
export function flatten(slide: Pick<SlideIR, 'children'>, cellId: (rowId: string, index: number) => string): FlatElement[] {
  const elements: FlatElement[] = [];
  const walk = (children: ElementIR[], parent: string) => {
    const parts = partition(children);
    for (const g of GROUPS) {
      const ids = parts[g].map((c) => (c.id === '' && CELL_TAGS.has(c.tag) ? cellId(parent, children.indexOf(c)) : c.id));
      const keys = rekey(ids, new Map(), GROUP_BOUNDS[g]);
      parts[g].forEach((c, i) => {
        const id = ids[i]!;
        const e: FlatElement = { id, tag: c.tag, parent, style: c.style, attrs: c.attrs };
        e[groupKey(g)] = keys.get(id)!;
        if (c.text) e.text = c.text;
        if (c.raw !== undefined) e.raw = c.raw;
        elements.push(e);
        if (CONTAINER_TAGS.has(c.tag)) walk(c.children, id);
      });
    }
  };
  walk(slide.children, ROOT);
  return elements;
}

/** Create a slide from IR (inside the caller's transaction). */
export function importSlide(doc: Doc, ir: SlideIR, order: string): void {
  Y.createSlide(doc, ir.id, { ...slideScalarsOf(ir), order }, ir.notes);
  const mint = cellMinter(doc, []);
  for (const e of flatten(ir, (rowId) => mint(rowId))) Y.createElement(doc, ir.id, e.id, toScalars(e), e.text);
}

// ---------------------------------------------------------------- model -> tree

export function readFlat(doc: Doc, slideId: string, withText = true): FlatElement[] {
  const out: FlatElement[] = [];
  for (const [id, s] of Y.allElementScalars(doc, slideId)) {
    const e = fromScalars(id, s);
    if (withText && TEXT_TAGS.has(e.tag)) e.text = Y.readText(doc, slideId, id);
    out.push(e);
  }
  return out;
}

/**
 * The effective parent of every element. Rules (deterministic in the state, so every replica draws the same tree):
 * a parent that does not exist or cannot hold children → the section (an orphan of a concurrent delete keeps its
 * content); a parent cycle (two concurrent "move into") → the cycle's smallest id moves to the section.
 */
export function resolveParents(els: FlatElement[]): Map<string, string> {
  const byId = new Map(els.map((e) => [e.id, e]));
  const eff = new Map<string, string>();
  for (const e of els) eff.set(e.id, e.parent !== ROOT && byId.has(e.parent) && CONTAINER_TAGS.has(byId.get(e.parent)!.tag) ? e.parent : ROOT);
  for (const e of [...els].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const seen: string[] = [];
    let cur = e.id;
    while (cur !== ROOT && !seen.includes(cur)) {
      seen.push(cur);
      cur = eff.get(cur)!;
    }
    if (cur !== ROOT) {
      // a cycle through `cur`
      const cycle = seen.slice(seen.indexOf(cur)).sort();
      eff.set(cycle[0]!, ROOT);
    }
  }
  return eff;
}

/** Children of each parent in paint/flow order: [under by z] [flow by order] [over by z], ties by id. */
export function childLists(els: FlatElement[], eff = resolveParents(els)): Map<string, FlatElement[]> {
  const buckets = new Map<string, Record<Group, FlatElement[]>>();
  for (const e of els) {
    const p = eff.get(e.id)!;
    if (!buckets.has(p)) buckets.set(p, { under: [], flow: [], over: [] });
    buckets.get(p)![groupOf(e)].push(e);
  }
  const out = new Map<string, FlatElement[]>();
  for (const [p, b] of buckets) {
    b.under.sort(byKey((e) => e.z));
    b.flow.sort(byKey((e) => e.order));
    b.over.sort(byKey((e) => e.z));
    out.set(p, [...b.under, ...b.flow, ...b.over]);
  }
  return out;
}

/** The slide as IR, its tree by the read rules. Cells carry their model ids (the serializer leaves them out). */
export function readSlide(doc: Doc, slideId: string): SlideIR {
  const s = Y.slideScalars(doc, slideId);
  const ir: SlideIR = { id: slideId, attrs: {}, style: {}, children: [], notes: Y.readNotes(doc, slideId) };
  for (const [k, v] of Object.entries(s)) {
    if (k.startsWith('style:')) ir.style[k.slice(6)] = v as string;
    else if (k.startsWith('attr:')) ir.attrs[k.slice(5)] = v as string;
  }
  const lists = childLists(readFlat(doc, slideId));
  const build = (p: string): ElementIR[] =>
    (lists.get(p) ?? []).map((e) => {
      const el: ElementIR = { id: e.id, tag: e.tag, attrs: e.attrs, style: e.style, children: CONTAINER_TAGS.has(e.tag) ? build(e.id) : [] };
      if (e.text) el.text = e.text;
      if (e.raw !== undefined) el.raw = e.raw;
      return el;
    });
  ir.children = build(ROOT);
  return ir;
}

/** Slide ids in deck order (by `order`, then id). */
export function slideOrder(doc: Doc): string[] {
  return Y.slideIds(doc)
    .map((id) => ({ id, order: Y.slideScalars(doc, id).order as string | undefined }))
    .sort(byKey((s) => s.order))
    .map((s) => s.id);
}

/** A held slide's file and reasons (the model keeps its last good content), or null. */
export function heldOf(doc: Doc, slideId: string): { source: string; reasons: string[] } | null {
  const held = Y.slideScalars(doc, slideId).held as { source: string; reasons: string[] } | undefined;
  return held ?? null;
}

/** The slide's file: canonical, or the held source verbatim with nothing lost. */
export function slideFile(doc: Doc, slideId: string): string {
  return heldOf(doc, slideId)?.source ?? serializeSlide(readSlide(doc, slideId));
}

const DECK_MAPS = ['sections', 'faces', 'dsOverrides'] as const;
export function readDeckJson(doc: Doc): DeckJson {
  const deck: DeckJson = { ...(Y.deckScalars(doc) as Record<string, unknown>), order: slideOrder(doc) };
  for (const name of DECK_MAPS) {
    const entries = Y.deckEntries(doc, name);
    if (entries) (deck as Record<string, unknown>)[name] = entries;
  }
  return deck;
}

/** The deck's files, as `artifact_read` returns them: the index, then every slide in deck order. */
export function deckFiles(doc: Doc): Record<string, string> {
  const files: Record<string, string> = { [DECK_PATH]: serializeDeckJson(readDeckJson(doc)) };
  for (const id of slideOrder(doc)) files[slidePath(id)] = slideFile(doc, id);
  return files;
}

/** `deckFiles`'s paths in its order, without reading a file (M3: a publish's `kept` and `removed`). */
export function deckPaths(doc: Doc): string[] {
  return [DECK_PATH, ...slideOrder(doc).map(slidePath)];
}

/** Write an index into the deck root (inside the caller's transaction): its keys but `order`, the maps as nested nodes. */
export function writeDeckKeys(doc: Doc, deck: DeckJson): void {
  for (const [key, value] of Object.entries(deck)) {
    if (key === 'order' || value === undefined) continue;
    if ((DECK_MAPS as readonly string[]).includes(key)) {
      const name = key as (typeof DECK_MAPS)[number];
      Y.ensureDeckMap(doc, name);
      for (const [k, v] of Object.entries(value as Record<string, DeckSection | DeckFace | string>)) Y.setDeckEntry(doc, name, k, v as Y.Json);
    } else Y.setDeckKey(doc, key, value as Y.Json);
  }
}

// ---------------------------------------------------------------- the editor's writers (one gesture = one transaction)

/** Values `null` remove the property. `id` ROOT ('') is the section. */
export function setStyle(doc: Doc, slideId: string, id: string, props: Record<string, string | null>, origin?: unknown): void {
  setKeys(doc, slideId, id, 'style:', props, origin);
}
/** Values `null` remove the attribute (`hidden` is present as ''). `id` ROOT ('') is the section. */
export function setAttrs(doc: Doc, slideId: string, id: string, attrs: Record<string, string | null>, origin?: unknown): void {
  setKeys(doc, slideId, id, 'attr:', attrs, origin);
}
function setKeys(doc: Doc, slideId: string, id: string, prefix: string, values: Record<string, string | null>, origin: unknown): void {
  transact(
    doc,
    () => {
      for (const [k, v] of Object.entries(values)) {
        if (id === ROOT) {
          if (v === null) Y.deleteSlideKey(doc, slideId, prefix + k);
          else Y.setSlideKey(doc, slideId, prefix + k, v);
        } else if (v === null) Y.deleteElementKey(doc, slideId, id, prefix + k);
        else Y.setElementKey(doc, slideId, id, prefix + k, v);
      }
    },
    origin,
  );
}

/** The speaker notes, by character diff (S6's `patchNotes`). */
export function setNotes(doc: Doc, slideId: string, text: string, origin?: unknown): void {
  transact(doc, () => void Y.patchNotes(doc, slideId, text), origin);
}

/** A text element's blocks, by character diff where the block kinds match (S6's `patchText`). */
export function setText(doc: Doc, slideId: string, id: string, blocks: TextBlock[], origin?: unknown): void {
  transact(doc, () => void Y.patchText(doc, slideId, id, blocks), origin);
}

/** The pinned siblings of an element in paint order with the flow layer between them, as the editor stacks them. */
function pinnedStack(els: FlatElement[], eff: Map<string, string>, parent: string): FlatElement[][] {
  const sibs = els.filter((e) => eff.get(e.id) === parent && groupOf(e) !== 'flow');
  const under = sibs.filter((e) => groupOf(e) === 'under').sort(byKey((e) => e.z));
  const over = sibs.filter((e) => groupOf(e) === 'over').sort(byKey((e) => e.z));
  return [under, over];
}

/**
 * Z-order on a pinned element (D8): `front` over everything, `back` under the flow layer (before the first flow child),
 * `forward` and `backward` one step through the stack, the flow layer counting as one step. Flow content is one layer:
 * a flow element has no z.
 */
export function zOrder(doc: Doc, slideId: string, id: string, to: 'front' | 'back' | 'forward' | 'backward', origin?: unknown): void {
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  const me = els.find((e) => e.id === id);
  if (!me) throw new Error(`no element ${slideId}/${id}`);
  if (!isPinned(me.tag, me.style, me.attrs)) throw new Error('z-order applies to pinned elements; flow content is one layer');
  const [under, over] = pinnedStack(els, eff, eff.get(id)!);
  // the stack bottom to top, the flow layer as null
  const stack: (FlatElement | null)[] = [...under!, null, ...over!];
  const at = stack.indexOf(me);
  stack.splice(at, 1);
  const place = to === 'front' ? stack.length : to === 'back' ? 0 : to === 'forward' ? Math.min(at + 1, stack.length) : Math.max(at - 1, 0);
  stack.splice(place, 0, me);
  const flowAt = stack.indexOf(null);
  const group: Group = stack.indexOf(me) < flowAt ? 'under' : 'over';
  const list = (group === 'under' ? stack.slice(0, flowAt) : stack.slice(flowAt + 1)) as FlatElement[];
  const current = new Map(list.filter((e) => e !== me && e.z !== undefined).map((e) => [e.id, e.z!]));
  const keys = rekey(
    list.map((e) => e.id),
    current,
    GROUP_BOUNDS[group],
  );
  if (keys.size === 0) return;
  transact(doc, () => keys.forEach((z, eid) => Y.setElementKey(doc, slideId, eid, 'z', z)), origin);
}

/** Re-parent (group / ungroup): one key, so a concurrent move and a concurrent re-parent never duplicate. */
export function moveInto(doc: Doc, slideId: string, id: string, parent: string, origin?: unknown): void {
  const els = readFlat(doc, slideId, false);
  const me = els.find((e) => e.id === id);
  if (!me) throw new Error(`no element ${slideId}/${id}`);
  const g = groupOf(me);
  const sibs = els.filter((e) => e.parent === parent && e.id !== id && groupOf(e) === g).map((e) => e[groupKey(g)]);
  transact(
    doc,
    () => {
      Y.setElementKey(doc, slideId, id, 'parent', parent);
      Y.setElementKey(doc, slideId, id, groupKey(g), keyAfter(sibs, GROUP_BOUNDS[g]));
    },
    origin,
  );
}

/** Flow re-order (D8): the flow child goes before `beforeId` among its flow siblings, or last when null. One key. */
export function reorderFlow(doc: Doc, slideId: string, id: string, beforeId: string | null, origin?: unknown): void {
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  const me = els.find((e) => e.id === id);
  if (!me || groupOf(me) !== 'flow') throw new Error(`${slideId}/${id} is not a flow element`);
  const sibs = els
    .filter((e) => e.id !== id && eff.get(e.id) === eff.get(id) && groupOf(e) === 'flow')
    .sort(byKey((e) => e.order))
    .map((e) => e.id);
  const at = beforeId === null ? sibs.length : sibs.indexOf(beforeId);
  if (at < 0) throw new Error(`${beforeId} is not a flow sibling of ${id}`);
  const desired = [...sibs.slice(0, at), id, ...sibs.slice(at)];
  const current = new Map(els.filter((e) => e.id !== id && desired.includes(e.id) && e.order !== undefined).map((e) => [e.id, e.order!]));
  const keys = rekey(desired, current, ANY);
  if (keys.size === 0) return;
  transact(doc, () => keys.forEach((k, eid) => Y.setElementKey(doc, slideId, eid, 'order', k)), origin);
}

/**
 * "Detach" (D8): a flow child becomes pinned at the box the editor measured (px, relative to its positioning host),
 * over the flow layer. The editor makes sure the host is the section or a `position:relative` div.
 */
export function detach(doc: Doc, slideId: string, id: string, box: { left: number; top: number; width?: number; height?: number }, origin?: unknown): void {
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  const me = els.find((e) => e.id === id);
  if (!me || groupOf(me) !== 'flow') throw new Error(`${slideId}/${id} is not a flow element`);
  const [, over] = pinnedStack(els, eff, eff.get(id)!);
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;
  transact(
    doc,
    () => {
      Y.setElementKey(doc, slideId, id, 'style:position', 'absolute');
      Y.setElementKey(doc, slideId, id, 'style:left', px(box.left));
      Y.setElementKey(doc, slideId, id, 'style:top', px(box.top));
      if (box.width !== undefined) Y.setElementKey(doc, slideId, id, 'style:width', px(box.width));
      if (box.height !== undefined) Y.setElementKey(doc, slideId, id, 'style:height', px(box.height));
      Y.deleteElementKey(doc, slideId, id, 'order');
      Y.setElementKey(
        doc,
        slideId,
        id,
        'z',
        keyAfter(
          over!.map((e) => e.z),
          OVER,
        ),
      );
    },
    origin,
  );
}

/** The element and its descendants as the model resolves them now. */
function subtree(els: FlatElement[], eff: Map<string, string>, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of els)
      if (!out.has(e.id) && out.has(eff.get(e.id)!)) {
        out.add(e.id);
        grew = true;
      }
  }
  return out;
}

/** Delete elements and their descendants as the model sees them now. */
export function deleteElementTree(doc: Doc, slideId: string, ids: string | string[], origin?: unknown): void {
  const els = readFlat(doc, slideId, false);
  const doomed = subtree(els, resolveParents(els), typeof ids === 'string' ? [ids] : ids);
  transact(doc, () => doomed.forEach((d) => Y.hasElement(doc, slideId, d) && Y.deleteElement(doc, slideId, d)), origin);
}

/**
 * Duplicate elements (D8's ⌘D) with their descendants under fresh ids: a flow copy right after its original, a pinned
 * copy at the front of the stack, moved by `offset` px when its left and top are px. Returns each original's copy.
 */
export function duplicateElements(doc: Doc, slideId: string, ids: string[], options: { offset?: number } = {}, origin?: unknown): Map<string, string> {
  const els = readFlat(doc, slideId, true);
  const eff = resolveParents(els);
  const byId = new Map(els.map((e) => [e.id, e]));
  const picked = new Set(ids);
  // a selected element inside another selected one is copied with it
  const roots = ids.filter((id) => byId.has(id) && ![...ancestors(eff, id)].some((a) => picked.has(a)));
  const mint = elementMinter(doc, slideId, byId.keys());
  const mintCell = cellMinter(doc, byId.keys());
  const copies = new Map<string, string>();
  const shift = (v: string | undefined) => {
    const m = v === undefined ? null : /^(-?\d+(?:\.\d+)?)px$/.exec(v);
    return m ? `${Math.round((Number(m[1]) + (options.offset ?? 0)) * 100) / 100}px` : v;
  };
  transact(
    doc,
    () => {
      for (const root of roots) {
        const me = byId.get(root)!;
        const parent = eff.get(root)!;
        const g = groupOf(me);
        const sibs = els.filter((e) => eff.get(e.id) === parent && groupOf(e) === g);
        let key: string;
        if (g === 'flow') {
          const ordered = sibs.sort(byKey((e) => e.order)).map((e) => e.id);
          const at = ordered.indexOf(root) + 1;
          const current = new Map(sibs.filter((e) => e.order !== undefined).map((e) => [e.id, e.order!]));
          key = rekey([...ordered.slice(0, at), '\u0000copy', ...ordered.slice(at)], current, ANY).get('\u0000copy')!;
        } else {
          const [, over] = pinnedStack(els, eff, parent);
          key = keyAfter(
            over!.map((e) => e.z),
            OVER,
          );
        }
        const copyTree = (src: FlatElement, newParent: string, placement: { order?: string; z?: string }) => {
          const id = CELL_TAGS.has(src.tag) ? mintCell(newParent) : mint(src.id);
          copies.set(src.id, id);
          const style = src.id === root && options.offset && g !== 'flow' ? { ...src.style, left: shift(src.style.left)!, top: shift(src.style.top)! } : src.style;
          const copy: FlatElement = { ...src, id, parent: newParent, style: Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)) };
          delete copy.order;
          delete copy.z;
          Object.assign(copy, placement);
          Y.createElement(doc, slideId, id, toScalars(copy), src.text);
          for (const child of els.filter((e) => eff.get(e.id) === src.id)) copyTree(child, id, { ...(child.order !== undefined && { order: child.order }), ...(child.z !== undefined && { z: child.z }) });
        };
        copyTree(me, parent, g === 'flow' ? { order: key } : { z: key });
      }
    },
    origin,
  );
  return new Map(roots.map((r) => [r, copies.get(r)!]));
}

function* ancestors(eff: Map<string, string>, id: string): Generator<string> {
  const seen = new Set<string>();
  for (let p = eff.get(id); p !== undefined && p !== ROOT && !seen.has(p); p = eff.get(p)) {
    seen.add(p);
    yield p;
  }
}

/** Slide re-order: one key on the moved slide. `afterId` null puts it first. */
export function moveSlide(doc: Doc, slideId: string, afterId: string | null, origin?: unknown): void {
  const ids = slideOrder(doc).filter((s) => s !== slideId);
  const at = afterId === null ? 0 : ids.indexOf(afterId) + 1;
  const desired = [...ids.slice(0, at), slideId, ...ids.slice(at)];
  const cur = new Map(ids.map((s) => [s, Y.slideScalars(doc, s).order as string]));
  const keys = rekey(desired, cur, ANY);
  transact(doc, () => keys.forEach((k, s) => Y.setSlideKey(doc, s, 'order', k)), origin);
}

/** A new slide from IR (a blank one, a layout, a paste) after `afterId`, or first when null. Its id must be new. */
export function insertSlide(doc: Doc, ir: SlideIR, afterId: string | null, origin?: unknown): void {
  if (!ID_RE.test(ir.id)) throw new Error(`slide id "${ir.id}" is not [A-Za-z0-9_-]{1,64}`);
  if (Y.hasSlide(doc, ir.id)) throw new Error(`the deck already holds a slide ${ir.id}`);
  const ids = slideOrder(doc);
  const at = afterId === null ? 0 : ids.indexOf(afterId) + 1;
  const cur = new Map(ids.map((s) => [s, Y.slideScalars(doc, s).order as string]));
  const keys = rekey([...ids.slice(0, at), ir.id, ...ids.slice(at)], cur, ANY);
  transact(
    doc,
    () => {
      importSlide(doc, ir, keys.get(ir.id)!);
      keys.forEach((k, s) => s !== ir.id && Y.setSlideKey(doc, s, 'order', k));
    },
    origin,
  );
}

export function deleteSlide(doc: Doc, slideId: string, origin?: unknown): void {
  transact(doc, () => Y.deleteSlide(doc, slideId), origin);
}

// ---------------------------------------------------------------- repair (the host runs it after applying an update)

/**
 * Write the deterministic resolution of states concurrency produced: orphans and cycles re-parented to the section,
 * equal sibling keys separated, equal slide keys separated. `slides` limits the element repair to those slides (the
 * ones an update touched); slide keys are always checked. Returns the number of keys written (0 on a clean state).
 */
export function repair(doc: Doc, options: { slides?: Iterable<string> } = {}, origin?: unknown): number {
  let writes = 0;
  transact(
    doc,
    () => {
      const all = Y.slideIds(doc);
      const slides = all.map((id) => ({ id, order: Y.slideScalars(doc, id).order as string | undefined }));
      for (const [id, k] of repairCollisions(slides, (s) => s.order, ANY)) {
        Y.setSlideKey(doc, id, 'order', k);
        writes++;
      }
      for (const sid of options.slides ?? all) {
        if (!Y.hasSlide(doc, sid) || Y.slideScalars(doc, sid).held) continue;
        const els = readFlat(doc, sid, false);
        const eff = resolveParents(els);
        for (const e of els)
          if (eff.get(e.id) !== e.parent) {
            Y.setElementKey(doc, sid, e.id, 'parent', eff.get(e.id)!);
            e.parent = eff.get(e.id)!;
            writes++;
          }
        const byParent = new Map<string, FlatElement[]>();
        for (const e of els) {
          if (!byParent.has(e.parent)) byParent.set(e.parent, []);
          byParent.get(e.parent)!.push(e);
        }
        for (const sibs of byParent.values())
          for (const g of GROUPS) {
            const list = sibs.filter((e) => groupOf(e) === g);
            for (const [id, k] of repairCollisions(list, (e) => e[groupKey(g)], GROUP_BOUNDS[g])) {
              Y.setElementKey(doc, sid, id, groupKey(g), k);
              writes++;
            }
          }
      }
    },
    origin,
  );
  return writes;
}

// ---------------------------------------------------------------- object anchors

export interface ElementAnchor {
  slideId: string;
  elementId: string;
}
export type AnchorState = { live: true; tag: Tag; parent: string } | { live: false };
/** An anchor resolves by ids alone: no path, index or position enters it, so moves, restyles, re-orders and publishes cannot move it. */
export function resolveAnchor(doc: Doc, a: ElementAnchor): AnchorState {
  if (!Y.hasElement(doc, a.slideId, a.elementId)) return { live: false };
  const s = Y.elementScalars(doc, a.slideId, a.elementId);
  return { live: true, tag: s.tag as Tag, parent: s.parent as string };
}
