// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer", "Inspector", "Insert"; M5): the
// editor's element gestures on the model, beside model.ts's writers (which they build on): one gesture one transaction
// with the caller's origin, and never a value the loader would refuse (a restyle is checked by css.ts first; inserted
// and pasted elements come through the loader; the slide's limits hold).
//
// - restyle: properties checked against the dialect's line, applies-to and limits, all or nothing.
// - setStyles: a gesture's frame (left/top/width/height/transform px from the transform layer) over several elements.
// - group / ungroup: pinned siblings into a pinned `div data-group` at their bounds, their offsets kept, and back.
// - insertElements / newElement / copyElements / pasteElements: new content, the clipboard's dialect HTML, ids
//   re-minted where they would collide on the slide.
// - tableRow / tableColumn: a table's rows and columns added and removed.
import { transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { checkStyle, type StyleSite } from './css';
import { pinToLeftTop, px, rotatedBounds, rotationOf, union, type Box, type Pt } from './geometry';
import { CELL_TAGS, CONTAINER_TAGS, isPinned, type ElementIR, type SlideIR, type Style, type Tag, type TextBlock } from './ir';
import { cellMinter, childLists, detach, duplicateElements, elementMinter, flatten, groupOf, readFlat, readSlide, resolveParents, ROOT, toScalars, type FlatElement } from './model';
import { ANY, OVER, rekey, UNDER } from './order';
import { loadSlide, SLIDE_LIMITS } from './parse';
import { serializeSlide } from './serialize';

// ---------------------------------------------------------------- restyle

/** Where an element's style sits, as the loader sees it (the section for ROOT). */
export function siteOf(doc: Doc, slideId: string, id: string): { site: StyleSite; style: Style } {
  const slide = Y.slideScalars(doc, slideId);
  const sectionStyle: Style = {};
  const sectionAttrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(slide)) {
    if (k.startsWith('style:')) sectionStyle[k.slice(6)] = v as string;
    else if (k.startsWith('attr:')) sectionAttrs[k.slice(5)] = v as string;
  }
  if (id === ROOT) return { site: { tag: 'section', attrs: sectionAttrs, parent: null }, style: sectionStyle };
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  const me = els.find((e) => e.id === id);
  if (!me) throw new Error(`no element ${slideId}/${id}`);
  const p = eff.get(id)!;
  const parent = p === ROOT ? { tag: 'section' as const, style: sectionStyle } : (() => {
    const pe = els.find((e) => e.id === p)!;
    return { tag: pe.tag, style: pe.style };
  })();
  return { site: { tag: me.tag, attrs: me.attrs, parent }, style: me.style };
}

/**
 * Sets (or with null removes) properties of one element (ROOT: the section), each checked as the loader would check it.
 * Returns the reasons a value would be dropped; when there is any, nothing is written.
 */
export function restyle(doc: Doc, slideId: string, id: string, props: Record<string, string | null>, origin?: unknown): string[] {
  const { site, style } = siteOf(doc, slideId, id);
  const next: Style = { ...style };
  for (const [k, v] of Object.entries(props)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  const problems: string[] = [];
  const writes: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === null) {
      writes[k] = null;
      continue;
    }
    const checked = checkStyle(k, v, { ...site, attrs: site.attrs }, next);
    if (checked.ok) writes[k] = checked.value;
    else problems.push(checked.reason);
  }
  if (problems.length) return problems;
  setStyles(doc, slideId, { [id]: writes }, origin);
  return [];
}

/** One frame of a gesture: style and attribute keys of several elements in one transaction; null removes. */
export interface ElementWrites {
  style?: Record<string, string | null>;
  attrs?: Record<string, string | null>;
}
export function writeElements(doc: Doc, slideId: string, writes: Record<string, ElementWrites>, origin?: unknown): void {
  transact(
    doc,
    () => {
      for (const [id, w] of Object.entries(writes))
        for (const [prefix, values] of [
          ['style:', w.style],
          ['attr:', w.attrs],
        ] as const)
          for (const [k, v] of Object.entries(values ?? {})) {
            if (id === ROOT) {
              if (v === null) Y.deleteSlideKey(doc, slideId, prefix + k);
              else Y.setSlideKey(doc, slideId, prefix + k, v);
            } else if (!Y.hasElement(doc, slideId, id)) continue;
            else if (v === null) Y.deleteElementKey(doc, slideId, id, prefix + k);
            else Y.setElementKey(doc, slideId, id, prefix + k, v);
          }
    },
    origin,
  );
}

/** Style keys of several elements (ROOT: the section) in one transaction; null removes. */
export function setStyles(doc: Doc, slideId: string, writes: Record<string, Record<string, string | null>>, origin?: unknown): void {
  writeElements(doc, slideId, Object.fromEntries(Object.entries(writes).map(([id, style]) => [id, { style }])), origin);
}

/** Attributes of several elements (ROOT: the section) in one transaction; null removes. */
export function setAttrsOf(doc: Doc, slideId: string, writes: Record<string, Record<string, string | null>>, origin?: unknown): void {
  writeElements(doc, slideId, Object.fromEntries(Object.entries(writes).map(([id, attrs]) => [id, { attrs }])), origin);
}

// ---------------------------------------------------------------- limits

/** The slide's room for `adding` elements (cells apart) and `pinned` more pinned children of `parent`; throws past them. */
function needRoom(els: FlatElement[], eff: Map<string, string>, parent: string, adding: { elements: number; cells: number; pinned: number }): void {
  const cells = els.filter((e) => CELL_TAGS.has(e.tag)).length;
  const elements = els.length - cells;
  if (elements + adding.elements > SLIDE_LIMITS.elements) throw new Error(`a slide holds at most ${SLIDE_LIMITS.elements} elements`);
  if (cells + adding.cells > SLIDE_LIMITS.cells) throw new Error(`a slide holds at most ${SLIDE_LIMITS.cells} table cells`);
  const pinned = els.filter((e) => eff.get(e.id) === parent && isPinned(e.tag, e.style, e.attrs)).length;
  if (adding.pinned > 0 && pinned + adding.pinned > SLIDE_LIMITS.pinnedPerHost) throw new Error(`a slide or group holds at most ${SLIDE_LIMITS.pinnedPerHost} pinned elements; split them across groups`);
}

/** The subtree of each id as the model resolves it now (the ids and their descendants). */
function subtreeOf(els: FlatElement[], eff: Map<string, string>, ids: readonly string[]): FlatElement[] {
  const inside = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of els)
      if (!inside.has(e.id) && inside.has(eff.get(e.id)!)) {
        inside.add(e.id);
        grew = true;
      }
  }
  return els.filter((e) => inside.has(e.id));
}

/**
 * ⌘D (D8): model.ts's `duplicateElements` within the slide's limits (each copy beside its original, a pinned copy
 * `offset` px on and at the front). Throws past them. Returns each original's copy.
 */
export function duplicateWithin(doc: Doc, slideId: string, ids: string[], offset: number, origin?: unknown): Map<string, string> {
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  const copies = subtreeOf(els, eff, ids);
  const pinnedBy = new Map<string, number>();
  for (const id of ids) {
    const e = els.find((x) => x.id === id);
    if (e && isPinned(e.tag, e.style, e.attrs)) pinnedBy.set(eff.get(id)!, (pinnedBy.get(eff.get(id)!) ?? 0) + 1);
  }
  const count = { elements: copies.filter((e) => !CELL_TAGS.has(e.tag)).length, cells: copies.filter((e) => CELL_TAGS.has(e.tag)).length };
  needRoom(els, eff, '\u0000', { ...count, pinned: 0 });
  for (const [parent, pinned] of pinnedBy) needRoom(els, eff, parent, { elements: 0, cells: 0, pinned });
  return duplicateElements(doc, slideId, ids, { offset }, origin);
}

/** "Detach" (D8) within the host's 24 pinned children: model.ts's `detach` at the box the editor measured. */
export function detachWithin(doc: Doc, slideId: string, id: string, box: { left: number; top: number; width?: number; height?: number }, origin?: unknown): void {
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  needRoom(els, eff, eff.get(id) ?? ROOT, { elements: 0, cells: 0, pinned: 1 });
  detach(doc, slideId, id, box, origin);
}

// ---------------------------------------------------------------- group and ungroup

const PX = /^(-?\d+(?:\.\d+)?)(px)?$/;
/** A connector's coordinate moved by `d` px (bare px or Npx); a % coordinate cannot move with its host and throws. */
function shiftCoord(v: string, d: number): string {
  const m = PX.exec(v.trim());
  if (!m) throw new Error('a connector placed in % of its host cannot move between hosts; give it px coordinates first');
  const n = Math.round((Number(m[1]) + d) * 100) / 100;
  return m[2] ? `${n}px` : String(n);
}
const COORDS = ['x1', 'y1', 'x2', 'y2'] as const;

/**
 * Groups pinned siblings (D8): a pinned `div data-group` at the bounds of their boxes (`boxes`: each member's layout box
 * in its host, px, as the editor measured it), its members re-parented into it with their offsets kept (a right/bottom
 * pin placed by its box), in their paint order; the group takes the topmost member's place. Returns the group's id.
 */
export function groupElements(doc: Doc, slideId: string, ids: string[], boxes: ReadonlyMap<string, Box>, origin?: unknown): string {
  if (ids.length < 2) throw new Error('a group needs at least two elements');
  if (ids.length > SLIDE_LIMITS.pinnedPerHost) throw new Error(`a group holds at most ${SLIDE_LIMITS.pinnedPerHost} pinned elements`);
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  const byId = new Map(els.map((e) => [e.id, e]));
  const members = ids.map((id) => {
    const e = byId.get(id);
    if (!e) throw new Error(`no element ${slideId}/${id}`);
    if (!isPinned(e.tag, e.style, e.attrs) || CELL_TAGS.has(e.tag) || e.tag === 'tr') throw new Error('only pinned elements group; detach flow elements first');
    if (!boxes.has(id)) throw new Error(`no measured box for ${id}`);
    return e;
  });
  const parent = eff.get(members[0]!.id)!;
  if (members.some((m) => eff.get(m.id) !== parent)) throw new Error('grouped elements share one parent');
  // paint order: the parent's under list, then its over list
  const stack = (childLists(els, eff).get(parent) ?? []).filter((e) => groupOf(e) !== 'flow');
  const inStack = members.slice().sort((a, b) => stack.indexOf(a) - stack.indexOf(b));
  const top = inStack[inStack.length - 1]!;
  const area = union(members.map((m) => rotatedBounds(boxes.get(m.id)!, rotationOf(m.style.transform))))!;
  const groupId = elementMinter(doc, slideId, byId.keys())('group');
  const innerKeys = rekey(
    inStack.map((m) => m.id),
    new Map(),
    OVER,
  );
  transact(
    doc,
    () => {
      Y.createElement(doc, slideId, groupId, {
        tag: 'div',
        parent,
        z: top.z!,
        'style:position': 'absolute',
        'style:left': px(area.x),
        'style:top': px(area.y),
        'style:width': px(area.w),
        'style:height': px(area.h),
        'attr:data-group': '',
      });
      for (const m of inStack) {
        const b = boxes.get(m.id)!;
        Y.setElementKey(doc, slideId, m.id, 'parent', groupId);
        Y.setElementKey(doc, slideId, m.id, 'z', innerKeys.get(m.id)!);
        if (m.tag === 'x-connector' && m.attrs.x1 !== undefined) {
          for (const c of COORDS) Y.setElementKey(doc, slideId, m.id, `attr:${c}`, shiftCoord(m.attrs[c] ?? '0', -(c.startsWith('x') ? area.x : area.y)));
          continue;
        }
        const writes = { ...pinToLeftTop(m.style, b), left: px(b.x - area.x), top: px(b.y - area.y) };
        for (const [k, v] of Object.entries(writes)) {
          if (v === null) Y.deleteElementKey(doc, slideId, m.id, `style:${k}`);
          else Y.setElementKey(doc, slideId, m.id, `style:${k}`, v);
        }
      }
    },
    origin,
  );
  return groupId;
}

/**
 * Ungroups a `div data-group` whose children are all pinned: they move to the group's parent at the group's place in the
 * paint order, their offsets plus the group's (px; with `boxes`, each child's measured box in the group's host places
 * it). The group goes. Returns the children in paint order. A turned group's rotation is not carried to its children.
 */
export function ungroup(doc: Doc, slideId: string, groupId: string, origin?: unknown, boxes?: ReadonlyMap<string, Box>): string[] {
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  const g = els.find((e) => e.id === groupId);
  if (!g || g.tag !== 'div' || g.attrs['data-group'] === undefined) throw new Error(`${groupId} is not a group`);
  const lists = childLists(els, eff);
  const kids = lists.get(groupId) ?? [];
  if (kids.some((k) => groupOf(k) === 'flow')) throw new Error('a group with flow content does not ungroup');
  const parent = eff.get(groupId)!;
  const gx = Number.parseFloat(g.style.left ?? '0') || 0;
  const gy = Number.parseFloat(g.style.top ?? '0') || 0;
  if (!boxes && (!PX.test(g.style.left ?? '0px') || !PX.test(g.style.top ?? '0px'))) throw new Error('the group is not placed by left/top px');
  const side = groupOf(g);
  const list = (lists.get(parent) ?? []).filter((e) => groupOf(e) === side);
  const desired = list.flatMap((e) => (e.id === groupId ? kids.map((k) => k.id) : [e.id]));
  const current = new Map(list.filter((e) => e.id !== groupId && e.z !== undefined).map((e) => [e.id, e.z!]));
  const keys = rekey(desired, current, side === 'under' ? UNDER : OVER);
  transact(
    doc,
    () => {
      for (const k of kids) {
        Y.setElementKey(doc, slideId, k.id, 'parent', parent);
        Y.setElementKey(doc, slideId, k.id, 'z', keys.get(k.id) ?? k.z!);
        if (k.tag === 'x-connector' && k.attrs.x1 !== undefined) {
          for (const c of COORDS) Y.setElementKey(doc, slideId, k.id, `attr:${c}`, shiftCoord(k.attrs[c] ?? '0', c.startsWith('x') ? gx : gy));
          continue;
        }
        const b = boxes?.get(k.id);
        let writes: Record<string, string | null>;
        if (b) writes = { ...pinToLeftTop(k.style, b), left: px(b.x), top: px(b.y) };
        else {
          if (!PX.test(k.style.left ?? '0px') || !PX.test(k.style.top ?? '0px') || k.style.right !== undefined || k.style.bottom !== undefined) throw new Error(`${k.id} is not placed by left/top px`);
          writes = { left: px((Number.parseFloat(k.style.left ?? '0') || 0) + gx), top: px((Number.parseFloat(k.style.top ?? '0') || 0) + gy) };
        }
        for (const [key, v] of Object.entries(writes)) {
          if (v === null) Y.deleteElementKey(doc, slideId, k.id, `style:${key}`);
          else Y.setElementKey(doc, slideId, k.id, `style:${key}`, v);
        }
      }
      for (const [id, z] of keys) if (id !== groupId && !kids.some((k) => k.id === id)) Y.setElementKey(doc, slideId, id, 'z', z);
      Y.deleteElement(doc, slideId, groupId);
    },
    origin,
  );
  return kids.map((k) => k.id);
}

// ---------------------------------------------------------------- insert

/** What the Insert menu makes (D8): text, heading, lists, the shape kinds, an icon, an image, a table, a line, a connector. */
export type NewKind = 'text' | 'heading' | 'bullets' | 'numbers' | `shape:${string}` | `icon:${string}` | `image:${string}` | `table:${number}x${number}` | 'line' | 'connector';

const ACCENT = 'var(--ds-color-accent, #2b7a78)';
const at = (c: Pt, w: number, h: number) => `position:absolute; left:${Math.round(c.x - w / 2)}px; top:${Math.round(c.y - h / 2)}px`;
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function markupOf(kind: NewKind, c: Pt): string {
  if (kind === 'text') return `<p style="${at(c, 800, 56)}; width:800px; font-size:40px">Text</p>`;
  if (kind === 'heading') return `<h2 style="${at(c, 1200, 74)}; width:1200px; font-size:64px">Heading</h2>`;
  if (kind === 'bullets' || kind === 'numbers') {
    const tag = kind === 'bullets' ? 'ul' : 'ol';
    return `<${tag} style="${at(c, 800, 150)}; width:800px; font-size:36px"><li>First</li><li>Second</li><li>Third</li></${tag}>`;
  }
  if (kind === 'line') return `<x-connector x1="${Math.round(c.x - 200)}" y1="${Math.round(c.y)}" x2="${Math.round(c.x + 200)}" y2="${Math.round(c.y)}" head="none" style="color:${ACCENT}; border-width:4px"></x-connector>`;
  if (kind === 'connector') return `<x-connector x1="${Math.round(c.x - 200)}" y1="${Math.round(c.y - 100)}" x2="${Math.round(c.x + 200)}" y2="${Math.round(c.y + 100)}" head="end" route="elbow" style="color:${ACCENT}; border-width:4px"></x-connector>`;
  const [what, arg = ''] = [kind.slice(0, kind.indexOf(':')), kind.slice(kind.indexOf(':') + 1)];
  if (what === 'shape') {
    const [w, h] = arg === 'line' ? [400, 8] : arg.startsWith('arrow-') ? (arg === 'arrow-up' || arg === 'arrow-down' ? [150, 300] : [300, 150]) : [300, 200];
    return `<x-shape kind="${escHtml(arg)}" style="${at(c, w, h)}; width:${w}px; height:${h}px; background:${ACCENT}"></x-shape>`;
  }
  if (what === 'icon') return `<x-icon name="${escHtml(arg)}" style="${at(c, 96, 96)}; width:96px; height:96px; color:${ACCENT}"></x-icon>`;
  if (what === 'image') return `<img src="${escHtml(arg)}" alt="" style="${at(c, 640, 360)}; width:640px; height:360px; object-fit:cover">`;
  if (what === 'table') {
    const [rows, cols] = arg.split('x').map(Number) as [number, number];
    const row = (cell: 'th' | 'td', r: number) => `<tr>${Array.from({ length: cols }, (_, k) => `<${cell}>${cell === 'th' ? `Column ${k + 1}` : r === 1 && k === 0 ? 'Value' : ''}</${cell}>`).join('')}</tr>`;
    return `<table style="${at(c, 1200, 64 * rows)}; width:1200px; font-size:28px">${Array.from({ length: rows }, (_, r) => row(r === 0 ? 'th' : 'td', r)).join('')}</table>`;
  }
  throw new Error(`nothing to insert as ${kind}`);
}

/** A new element of `kind` centred at `centre` (slide px), loaded through the dialect's loader. */
export function newElement(kind: NewKind, centre: Pt): ElementIR {
  const loaded = loadSlide(`<section id="insert">${markupOf(kind, centre)}</section>`);
  if (!loaded.ok) throw new Error(`a new ${kind} does not load: ${loaded.held.reasons.join('; ')}`);
  const warning = loaded.diagnostics.find((d) => d.severity === 'warning');
  if (warning) throw new Error(`a new ${kind} loads with a warning: ${warning.message}`);
  return loaded.slide.children[0]!;
}

function* walk(e: ElementIR): Generator<ElementIR> {
  yield e;
  for (const c of e.children) yield* walk(c);
}

export interface InsertOptions {
  /** The container to insert into (ROOT, the section, by default). */
  parent?: string;
  /** A flow element of `parent` the new flow elements follow; else they go last. */
  after?: string | null;
}

/**
 * Inserts elements (with their descendants) into a slide in one transaction: pinned ones at the front of `parent`'s
 * stack, flow ones after `after` (else last). An id the slide already holds is re-minted (deep). Throws past the slide's
 * limits. Returns the top-level elements' ids in order.
 */
export function insertElements(doc: Doc, slideId: string, elements: ElementIR[], options: InsertOptions = {}, origin?: unknown): string[] {
  const parent = options.parent ?? ROOT;
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  if (parent !== ROOT && !els.some((e) => e.id === parent && CONTAINER_TAGS.has(e.tag))) throw new Error(`${parent} is not a container on ${slideId}`);
  const all = elements.flatMap((e) => [...walk(e)]);
  needRoom(els, eff, parent, {
    elements: all.filter((e) => !CELL_TAGS.has(e.tag)).length,
    cells: all.filter((e) => CELL_TAGS.has(e.tag)).length,
    pinned: elements.filter((e) => isPinned(e.tag, e.style, e.attrs)).length,
  });
  // ids the slide holds are re-minted (cells mint their own ids below)
  const taken = new Set(els.map((e) => e.id));
  const mint = elementMinter(doc, slideId, [...taken, ...all.map((e) => e.id)]);
  const renamed = elements.map(function rename(e: ElementIR): ElementIR {
    const id = e.id !== '' && taken.has(e.id) ? mint(e.id) : e.id;
    if (id !== '') taken.add(id);
    return { ...e, id, children: e.children.map(rename) };
  });
  const mintCell = cellMinter(doc, taken);
  const flat = flatten({ children: renamed }, (rowId) => mintCell(rowId));
  const roots = new Set(renamed.map((e) => e.id));
  // keys for the roots among the parent's own children
  const lists = childLists(els, eff).get(parent) ?? [];
  const over = lists.filter((e) => groupOf(e) === 'over');
  const flow = lists.filter((e) => groupOf(e) === 'flow').map((e) => e.id);
  const pinnedRoots = renamed.filter((e) => isPinned(e.tag, e.style, e.attrs)).map((e) => e.id);
  const flowRoots = renamed.filter((e) => !isPinned(e.tag, e.style, e.attrs)).map((e) => e.id);
  const zKeys = rekey([...over.map((e) => e.id), ...pinnedRoots], new Map(over.filter((e) => e.z !== undefined).map((e) => [e.id, e.z!])), OVER);
  const afterAt = options.after ? flow.indexOf(options.after) : -1;
  const at = afterAt >= 0 ? afterAt + 1 : flow.length;
  const flowDesired = [...flow.slice(0, at), ...flowRoots, ...flow.slice(at)];
  const orderKeys = rekey(flowDesired, new Map(lists.filter((e) => groupOf(e) === 'flow' && e.order !== undefined).map((e) => [e.id, e.order!])), ANY);
  transact(
    doc,
    () => {
      for (const f of flat) {
        const e: FlatElement = { ...f };
        if (roots.has(f.id)) {
          e.parent = parent;
          delete e.order;
          delete e.z;
          if (isPinned(e.tag, e.style, e.attrs)) e.z = zKeys.get(f.id)!;
          else e.order = orderKeys.get(f.id)!;
        }
        Y.createElement(doc, slideId, e.id, toScalars(e), f.text);
      }
      for (const [id, k] of zKeys) if (!roots.has(id)) Y.setElementKey(doc, slideId, id, 'z', k);
      for (const [id, k] of orderKeys) if (!roots.has(id)) Y.setElementKey(doc, slideId, id, 'order', k);
    },
    origin,
  );
  return renamed.map((e) => e.id);
}

// ---------------------------------------------------------------- the clipboard

const CLIPBOARD_ID = 'clipboard';

/** The selected elements (and their descendants), as one slide file of the dialect: what the clipboard carries. */
export function copyElements(doc: Doc, slideId: string, ids: readonly string[]): string {
  const slide = readSlide(doc, slideId);
  const picked = new Set(ids);
  const roots: ElementIR[] = [];
  const visit = (children: ElementIR[]) => {
    for (const c of children) {
      if (picked.has(c.id)) roots.push(c);
      else visit(c.children);
    }
  };
  visit(slide.children);
  const ir: SlideIR = { id: CLIPBOARD_ID, attrs: {}, style: {}, children: roots, notes: '' };
  return serializeSlide(ir);
}

export interface PasteOptions {
  /** px added to a pinned element's left/top when its id is already on the slide (a paste beside its original). */
  offset?: number;
  /** A flow element the pasted flow elements follow. */
  after?: string | null;
}

/** Pastes a clipboard's dialect HTML (a slide file) into a slide through the loader. Never throws for what it reads. */
export function pasteElements(doc: Doc, slideId: string, html: string, options: PasteOptions = {}, origin?: unknown): { ok: true; ids: string[] } | { ok: false; reason: string } {
  const section = /^\s*<section[\s>]/i.test(html) ? html : `<section id="${CLIPBOARD_ID}">${html}</section>`;
  const loaded = loadSlide(section);
  if (!loaded.ok) return { ok: false, reason: `the pasted content does not load: ${loaded.held.reasons.join('; ')}` };
  if (loaded.slide.children.length === 0) return { ok: false, reason: 'nothing to paste' };
  const existing = new Set(Y.elementIds(doc, slideId));
  const offset = options.offset ?? 0;
  const children = loaded.slide.children.map((e) => {
    if (!existing.has(e.id) || !offset || !isPinned(e.tag, e.style, e.attrs)) return e;
    const style: Style = { ...e.style };
    for (const k of ['left', 'top'] as const) {
      const m = PX.exec(style[k] ?? '');
      if (m) style[k] = px(Number(m[1]) + offset);
    }
    return { ...e, style };
  });
  try {
    return { ok: true, ids: insertElements(doc, slideId, children, { after: options.after ?? null }, origin) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- tables

const EMPTY_CELL: TextBlock[] = [{ type: 'p', inline: [] }];

function tableOf(doc: Doc, slideId: string, tableId: string) {
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  const table = els.find((e) => e.id === tableId);
  if (!table || table.tag !== 'table') throw new Error(`${tableId} is not a table`);
  const lists = childLists(els, eff);
  const rows = (lists.get(tableId) ?? []).filter((e) => e.tag === 'tr');
  return { els, eff, rows, cellsOf: (rowId: string) => (lists.get(rowId) ?? []).filter((e) => CELL_TAGS.has(e.tag)) };
}

/** Adds an empty row after `add` (its cells as many as that row's, `td`), or removes the row `remove` (never the last). */
export function tableRow(doc: Doc, slideId: string, tableId: string, op: { add: string } | { remove: string }, origin?: unknown): string | null {
  const { els, rows, cellsOf } = tableOf(doc, slideId, tableId);
  if ('remove' in op) {
    if (!rows.some((r) => r.id === op.remove)) throw new Error(`${op.remove} is not a row of ${tableId}`);
    if (rows.length <= 1) throw new Error('a table keeps its last row');
    const doomed = [op.remove, ...cellsOf(op.remove).map((c) => c.id)];
    transact(doc, () => doomed.forEach((id) => Y.deleteElement(doc, slideId, id)), origin);
    return null;
  }
  const ref = rows.find((r) => r.id === op.add);
  if (!ref) throw new Error(`${op.add} is not a row of ${tableId}`);
  if (rows.length >= SLIDE_LIMITS.tableRows) throw new Error(`a table holds at most ${SLIDE_LIMITS.tableRows} rows`);
  const width = cellsOf(ref.id).length;
  needRoom(els, new Map(), '\u0000', { elements: 1, cells: width, pinned: 0 });
  const rowId = elementMinter(doc, slideId, els.map((e) => e.id))('row');
  const mintCell = cellMinter(doc, els.map((e) => e.id));
  const ids = rows.map((r) => r.id);
  const desired = [...ids.slice(0, ids.indexOf(ref.id) + 1), rowId, ...ids.slice(ids.indexOf(ref.id) + 1)];
  const keys = rekey(desired, new Map(rows.filter((r) => r.order !== undefined).map((r) => [r.id, r.order!])), ANY);
  const cellKeys = rekey(
    Array.from({ length: width }, (_, i) => String(i)),
    new Map(),
    ANY,
  );
  transact(
    doc,
    () => {
      Y.createElement(doc, slideId, rowId, { tag: 'tr', parent: tableId, order: keys.get(rowId)! });
      for (let i = 0; i < width; i++) Y.createElement(doc, slideId, mintCell(rowId), { tag: 'td', parent: rowId, order: cellKeys.get(String(i))! }, EMPTY_CELL);
      for (const [id, k] of keys) if (id !== rowId) Y.setElementKey(doc, slideId, id, 'order', k);
    },
    origin,
  );
  return rowId;
}

/** Adds an empty column after column `add` (0-based; a header row's new cell is a `th`), or removes column `remove`. */
export function tableColumn(doc: Doc, slideId: string, tableId: string, op: { add: number } | { remove: number }, origin?: unknown): void {
  const { els, rows, cellsOf } = tableOf(doc, slideId, tableId);
  const width = Math.max(0, ...rows.map((r) => cellsOf(r.id).length));
  if ('remove' in op) {
    if (width <= 1) throw new Error('a table keeps its last column');
    const doomed = rows.flatMap((r) => cellsOf(r.id)[op.remove]?.id ?? []);
    transact(doc, () => doomed.forEach((id) => Y.deleteElement(doc, slideId, id)), origin);
    return;
  }
  if (width >= SLIDE_LIMITS.tableColumns) throw new Error(`a table holds at most ${SLIDE_LIMITS.tableColumns} columns`);
  needRoom(els, new Map(), '\u0000', { elements: 0, cells: rows.length, pinned: 0 });
  const mintCell = cellMinter(doc, els.map((e) => e.id));
  transact(
    doc,
    () => {
      for (const r of rows) {
        const cells = cellsOf(r.id);
        const at = Math.min(op.add + 1, cells.length);
        const tag: Tag = cells[Math.min(op.add, cells.length - 1)]?.tag ?? 'td';
        const placeholder = '\u0000new';
        const keys = rekey(
          [...cells.slice(0, at).map((c) => c.id), placeholder, ...cells.slice(at).map((c) => c.id)],
          new Map(cells.filter((c) => c.order !== undefined).map((c) => [c.id, c.order!])),
          ANY,
        );
        Y.createElement(doc, slideId, mintCell(r.id), { tag, parent: r.id, order: keys.get(placeholder)! }, EMPTY_CELL);
        for (const [id, k] of keys) if (id !== placeholder) Y.setElementKey(doc, slideId, id, 'order', k);
      }
    },
    origin,
  );
}

