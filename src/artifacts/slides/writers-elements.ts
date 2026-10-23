// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Transform layer", "Inspector", "Insert"; M5): the
// editor's element gestures on the model, beside model.ts's writers (which they build on): one gesture one transaction
// with the caller's origin, and never a value the loader would refuse (a restyle is checked by css.ts first; inserted
// and pasted elements come through the loader; the slide's limits hold).
//
// - restyle: properties checked against the dialect's line, applies-to and limits, all or nothing.
// - setStyles: a gesture's frame (left/top/width/height/transform px from the transform layer) over several elements.
// - group / ungroup: pinned siblings into a pinned `div data-group` at their bounds, their offsets kept, and back, each
//   child where it is drawn (a turned group's transform folded into its children's).
// - Fix wave 1: every structural writer builds a plan the dialect's own loader judges (`commit`) before one transaction
//   writes it: a refusal writes nothing, and nothing written is held.
// - insertElements / newElement / copyElements / pasteElements: new content, the clipboard's dialect HTML, ids
//   re-minted where they would collide on the slide.
// - tableRow / tableColumn: a table's rows and columns added and removed.
import { transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { checkStyle, type StyleSite } from './css';
import { connectorRoute } from './glyphs';
import { apply, boundsOf, cornersOf, isIdentityLinear, linear, multiply, pinToLeftTop, placement, px, readTransform, shift, transformOf, union, type Box, type Pt } from './geometry';
import { CELL_TAGS, CONTAINER_TAGS, isPinned, type ElementIR, type SlideIR, type Style, type Tag, type TextBlock } from './ir';
import { cellMinter, childLists, elementMinter, flatten, fromScalars, groupOf, quoteSource, readFlat, readSlide, resolveParents, ROOT, toScalars, type FlatElement } from './model';
import { ANY, keyAfter, OVER, rekey, UNDER } from './order';
import { loadSlide } from './parse';
import { storeRemovedQuotes } from './quote'; // P3-C M7 fix wave 1
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

// ---------------------------------------------------------------- plans: checked by the loader, then written once

/**
 * A gesture's changes to one slide's elements (fix wave 1): records created (descendants included), model keys set
 * (`style:left`, `attr:x1`, `parent`, `z`, `order`; null deletes) and elements removed. A structural writer builds its
 * plan, `commit` asks the dialect's own loader whether the slide it makes would load (every limit the loader holds a slide
 * for: elements, cells, text and marks, pinned children per host, nesting, embeds, tables), and only then writes it, as
 * one transaction. A refusal throws before anything is written.
 */
export interface Plan {
  create: FlatElement[];
  set: Map<string, Record<string, Y.Json | null>>;
  remove: Set<string>;
}
const newPlan = (): Plan => ({ create: [], set: new Map(), remove: new Set() });
function put(plan: Plan, id: string, key: string, value: Y.Json | null): void {
  if (!plan.set.has(id)) plan.set.set(id, {});
  plan.set.get(id)![key] = value;
}
const putStyle = (plan: Plan, id: string, writes: Record<string, string | null>) => Object.entries(writes).forEach(([k, v]) => put(plan, id, `style:${k}`, v));

/** The slide as the plan would leave it, read by the model's rules (readSlide's). */
function projected(doc: Doc, slideId: string, plan: Plan): SlideIR {
  const base = readSlide(doc, slideId);
  const els = readFlat(doc, slideId, true)
    .filter((e) => !plan.remove.has(e.id))
    .map((e) => {
      const keys = plan.set.get(e.id);
      if (!keys) return e;
      const scalars = toScalars(e);
      for (const [k, v] of Object.entries(keys)) {
        if (v === null) delete scalars[k];
        else scalars[k] = v;
      }
      const next = fromScalars(e.id, scalars);
      if (e.text) next.text = e.text;
      return next;
    });
  els.push(...plan.create);
  const lists = childLists(els);
  const build = (p: string): ElementIR[] =>
    (lists.get(p) ?? []).map((e) => {
      const el: ElementIR = { id: e.id, tag: e.tag, attrs: e.attrs, style: e.style, children: CONTAINER_TAGS.has(e.tag) ? build(e.id) : [] };
      if (e.text) el.text = e.text;
      if (e.raw !== undefined) el.raw = e.raw;
      return el;
    });
  return { ...base, children: build(ROOT) };
}

/**
 * Throws the loader's reasons when the slide the plan makes would be held, or would lose (with a warning) anything the
 * plan wrote; the loader is the one judge of the dialect's limits, so no rule is kept twice.
 */
export function preflight(doc: Doc, slideId: string, plan: Plan): void {
  const loaded = loadSlide(serializeSlide(projected(doc, slideId, plan)), { fileId: slideId });
  if (!loaded.ok) throw new Error(`the slide would not load: ${loaded.held.reasons.join('; ')}`);
  const touched = new Set([...plan.create.map((e) => e.id), ...plan.set.keys()]);
  const lost = loaded.diagnostics.find((d) => d.severity === 'warning' && d.element !== undefined && touched.has(d.element));
  if (lost) throw new Error(lost.message);
}

/** Checks the plan, then writes it as one transaction with `origin`. */
export function commit(doc: Doc, slideId: string, plan: Plan, origin?: unknown): void {
  preflight(doc, slideId, plan);
  transact(
    doc,
    () => {
      if (plan.remove.size > 0) storeRemovedQuotes(doc, slideId, plan.remove, () => quoteSource(doc, slideId)); // M7 fix wave 1
      for (const id of plan.remove) if (Y.hasElement(doc, slideId, id)) Y.deleteElement(doc, slideId, id);
      for (const e of plan.create) Y.createElement(doc, slideId, e.id, toScalars(e), e.text);
      for (const [id, keys] of plan.set)
        for (const [k, v] of Object.entries(keys)) {
          if (!Y.hasElement(doc, slideId, id)) continue;
          if (v === null) Y.deleteElementKey(doc, slideId, id, k);
          else Y.setElementKey(doc, slideId, id, k, v);
        }
    },
    origin,
  );
}

/**
 * ⌘D (D8): a copy of each element (and its descendants) under fresh ids, a flow copy right after its original, a pinned
 * copy at the front of its stack `offset` px on (when its left and top are px); refused, unwritten, past the slide's
 * limits. Returns each original's copy.
 */
export function duplicateWithin(doc: Doc, slideId: string, ids: string[], offset: number, origin?: unknown): Map<string, string> {
  const els = readFlat(doc, slideId, true);
  const eff = resolveParents(els);
  const byId = new Map(els.map((e) => [e.id, e]));
  const picked = new Set(ids);
  const inside = (id: string) => {
    for (let p = eff.get(id); p !== undefined && p !== ROOT; p = eff.get(p)) if (picked.has(p)) return true;
    return false;
  };
  const roots = ids.filter((id) => byId.has(id) && !inside(id));
  const mint = elementMinter(doc, slideId, byId.keys());
  const mintCell = cellMinter(doc, byId.keys());
  const lists = childLists(els, eff);
  const plan = newPlan();
  const copies = new Map<string, string>();
  // per parent: the flow order with each copy after its original, and the pinned copies on top
  const byParent = new Map<string, string[]>();
  for (const root of roots) {
    const p = eff.get(root)!;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(root);
  }
  for (const [parent, mine] of byParent) {
    const sibs = lists.get(parent) ?? [];
    const flow = sibs.filter((e) => groupOf(e) === 'flow');
    const over = sibs.filter((e) => groupOf(e) === 'over');
    const flowDesired = flow.flatMap((e) => (mine.includes(e.id) ? [e.id, `\u0000${e.id}`] : [e.id]));
    const orderKeys = rekey(flowDesired, new Map(flow.filter((e) => e.order !== undefined).map((e) => [e.id, e.order!])), ANY);
    const pinnedMine = sibs.filter((e) => mine.includes(e.id) && groupOf(e) !== 'flow').map((e) => `\u0000${e.id}`);
    const zKeys = rekey([...over.map((e) => e.id), ...pinnedMine], new Map(over.filter((e) => e.z !== undefined).map((e) => [e.id, e.z!])), OVER);
    for (const [id, k] of orderKeys) if (!id.startsWith('\u0000')) put(plan, id, 'order', k);
    for (const [id, k] of zKeys) if (!id.startsWith('\u0000')) put(plan, id, 'z', k);
    for (const root of mine) {
      const me = byId.get(root)!;
      const copyTree = (src: FlatElement, newParent: string, placement: { order?: string; z?: string }, top: boolean) => {
        const id = CELL_TAGS.has(src.tag) ? mintCell(newParent) : mint(src.id);
        copies.set(src.id, id);
        const style = { ...src.style };
        if (top && groupOf(src) !== 'flow' && offset)
          for (const k of ['left', 'top'] as const) {
            const m = /^(-?\d+(?:\.\d+)?)px$/.exec(style[k] ?? '');
            if (m) style[k] = px(Number(m[1]) + offset);
          }
        const copy: FlatElement = { ...src, id, parent: newParent, style };
        delete copy.order;
        delete copy.z;
        Object.assign(copy, placement);
        plan.create.push(copy);
        for (const child of lists.get(src.id) ?? []) copyTree(child, id, child.order !== undefined ? { order: child.order } : child.z !== undefined ? { z: child.z } : {}, false);
      };
      copyTree(me, parent, groupOf(me) === 'flow' ? { order: orderKeys.get(`\u0000${root}`)! } : { z: zKeys.get(`\u0000${root}`)! }, true);
    }
  }
  commit(doc, slideId, plan, origin);
  return new Map(roots.map((r) => [r, copies.get(r)!]));
}

/** Freeze a measured layout atomically; the loader validates all pins before any write. */
export function preparePinnedLayout(doc: Doc, slideId: string, writes: Record<string, ElementWrites>): (origin: unknown) => void {
  const plan = newPlan();
  const elements = readFlat(doc, slideId, false);
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const [id, write] of Object.entries(writes)) {
    if (write.style) putStyle(plan, id, write.style);
    for (const [key, value] of Object.entries(write.attrs ?? {})) put(plan, id, `attr:${key}`, value);
    if (byId.get(id)?.order !== undefined) put(plan, id, 'order', null);
  }
  for (const children of childLists(elements).values()) {
    const ids = children.filter((child) => writes[child.id]).map((child) => child.id);
    const current = new Map(children.filter((child) => child.z !== undefined).map((child) => [child.id, child.z!]));
    for (const [id, key] of rekey(ids, current, OVER)) put(plan, id, 'z', key);
  }
  preflight(doc, slideId, plan);
  return (origin) => commit(doc, slideId, plan, origin);
}

/** "Detach" (D8): a flow child pinned over the flow layer at the box the editor measured; refused past the host's limit. */
export function detachWithin(doc: Doc, slideId: string, id: string, box: { left: number; top: number; width?: number; height?: number }, origin?: unknown): void {
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  const me = els.find((e) => e.id === id);
  if (!me || groupOf(me) !== 'flow') throw new Error(`${slideId}/${id} is not a flow element`);
  const over = (childLists(els, eff).get(eff.get(id)!) ?? []).filter((e) => groupOf(e) === 'over');
  const plan = newPlan();
  putStyle(plan, id, { position: 'absolute', left: px(box.left), top: px(box.top), ...(box.width !== undefined && { width: px(box.width) }), ...(box.height !== undefined && { height: px(box.height) }) });
  put(plan, id, 'order', null);
  put(
    plan,
    id,
    'z',
    keyAfter(
      over.map((e) => e.z),
      OVER,
    ),
  );
  commit(doc, slideId, plan, origin);
}

// ---------------------------------------------------------------- group and ungroup

const PX = /^(-?\d+(?:\.\d+)?)(px)?$/;
/** A connector's coordinate as a number of px; a % coordinate cannot move with its host and throws. */
function coordOf(v: string | undefined): number {
  const m = PX.exec((v ?? '0').trim());
  if (!m) throw new Error('a connector placed in % of its host cannot move between hosts; give it px coordinates first');
  return Number(m[1]);
}
const num = (n: number) => String(Math.round(n * 100) / 100);
const COORDS = [
  ['x1', 'y1'],
  ['x2', 'y2'],
] as const;
const pxOf = (v: string | undefined): number | null => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v ?? '');
  return m ? Number(m[1]) : null;
};

/**
 * Groups pinned siblings (D8): a pinned `div data-group` at the bounds of their boxes as drawn (`boxes`: each member's
 * layout box in its host, px, as the editor measured it; each member's own transform counted), its members re-parented
 * into it with their offsets kept (a right/bottom pin placed by its box), in their paint order; the group takes the
 * topmost member's place. Refused, unwritten, when the slide it makes would not load. Returns the group's id.
 */
export function groupElements(doc: Doc, slideId: string, ids: string[], boxes: ReadonlyMap<string, Box>, origin?: unknown): string {
  if (ids.length < 2) throw new Error('a group needs at least two elements');
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
  const stack = (childLists(els, eff).get(parent) ?? []).filter((e) => groupOf(e) !== 'flow');
  const inStack = members.slice().sort((a, b) => stack.indexOf(a) - stack.indexOf(b));
  const top = inStack[inStack.length - 1]!;
  const drawn = (m: FlatElement): Box => {
    if (m.tag === 'x-connector' && m.attrs.x1 !== undefined) {
      const pts = COORDS.map(([x, y]) => ({ x: coordOf(m.attrs[x]), y: coordOf(m.attrs[y]) }));
      return boundsOf(pts);
    }
    return boundsOf(cornersOf(placement(boxes.get(m.id)!, m.style.transform), boxes.get(m.id)!.w, boxes.get(m.id)!.h));
  };
  const area = union(members.map(drawn))!;
  const groupId = elementMinter(doc, slideId, byId.keys())('group');
  const innerKeys = rekey(
    inStack.map((m) => m.id),
    new Map(),
    OVER,
  );
  const plan = newPlan();
  plan.create.push({ id: groupId, tag: 'div', parent, z: top.z!, style: { position: 'absolute', left: px(area.x), top: px(area.y), width: px(area.w), height: px(area.h) }, attrs: { 'data-group': '' } });
  for (const m of inStack) {
    put(plan, m.id, 'parent', groupId);
    put(plan, m.id, 'z', innerKeys.get(m.id)!);
    if (m.tag === 'x-connector' && m.attrs.x1 !== undefined) {
      for (const [x, y] of COORDS) {
        put(plan, m.id, `attr:${x}`, num(coordOf(m.attrs[x]) - area.x));
        put(plan, m.id, `attr:${y}`, num(coordOf(m.attrs[y]) - area.y));
      }
      continue;
    }
    const b = boxes.get(m.id)!;
    putStyle(plan, m.id, { ...pinToLeftTop(m.style, b), ...bakedSize(m.style, b), left: px(b.x - area.x), top: px(b.y - area.y) });
  }
  commit(doc, slideId, plan, origin);
  return groupId;
}

/**
 * Ungroups a `div data-group` whose children are all pinned: they move to the group's parent at the group's place in the
 * paint order, each where it is drawn: the group's offset added and, for a turned, scaled or skewed group, the group's
 * transform folded into the child's own (rotate, scale and skew within the dialect's ranges). `boxes` (each child's
 * layout box in the group, as measured) places a child not pinned by left/top px. Refused, unwritten, when a pose has no
 * form in the dialect or the slide it makes would not load. Returns the children in paint order.
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
  const [gx, gy] = [pxOf(g.style.left ?? '0px'), pxOf(g.style.top ?? '0px')];
  if (gx === null || gy === null) throw new Error('the group is not placed by left/top px');
  // the group's whole pose (its offset, and any transform, a translation alone included); one that cannot be read is
  // refused rather than read as absent (fix wave 2)
  const [gw, gh] = [pxOf(g.style.width), pxOf(g.style.height)];
  let G = shift(gx, gy);
  if (g.style.transform !== undefined) {
    const sized = gw !== null && gh !== null;
    const M = readTransform(g.style.transform, gw ?? 0, gh ?? 0);
    if (!M) throw new Error(`the group's transform ${g.style.transform} cannot be read; give it plain values first`);
    if (!sized && (!isIdentityLinear(M) || g.style.transform.includes('%'))) throw new Error('a turned or %-translated group ungroups only with a px width and height');
    G = placement({ x: gx, y: gy, w: gw ?? 0, h: gh ?? 0 }, g.style.transform);
  }
  const turned = !isIdentityLinear(G);
  const side = groupOf(g);
  const list = (lists.get(parent) ?? []).filter((e) => groupOf(e) === side);
  const desired = list.flatMap((e) => (e.id === groupId ? kids.map((k) => k.id) : [e.id]));
  const current = new Map(list.filter((e) => e.id !== groupId && e.z !== undefined).map((e) => [e.id, e.z!]));
  const keys = rekey(desired, current, side === 'under' ? UNDER : OVER);
  const plan = newPlan();
  plan.remove.add(groupId);
  for (const k of kids) {
    put(plan, k.id, 'parent', parent);
    put(plan, k.id, 'z', keys.get(k.id) ?? k.z!);
    if (k.tag === 'x-connector' && k.attrs.x1 !== undefined) {
      for (const [key, value] of Object.entries(routedOut(k.attrs, G))) put(plan, k.id, `attr:${key}`, value);
      continue;
    }
    const own = { x: pxOf(k.style.left), y: pxOf(k.style.top), w: pxOf(k.style.width), h: pxOf(k.style.height) };
    const measured = boxes?.get(k.id);
    const box: Box | null = measured ?? (own.x !== null && own.y !== null && k.style.right === undefined && k.style.bottom === undefined ? { x: own.x, y: own.y, w: own.w ?? 0, h: own.h ?? 0 } : null);
    if (!box) throw new Error(`${k.id} is not placed by left/top px`);
    const sizes = bakedSize(k.style, box);
    if (!turned) {
      // the group's offset and translation carry the child's place; its own transform is untouched
      const at = apply(G, { x: box.x, y: box.y });
      putStyle(plan, k.id, { ...pinToLeftTop(k.style, box), ...sizes, left: px(at.x), top: px(at.y) });
      continue;
    }
    if (own.w === null && !measured) throw new Error(`${k.id} has no size to turn about`);
    const mine = readTransform(k.style.transform, box.w, box.h);
    if (!mine) throw new Error(`${k.id}'s transform ${k.style.transform} cannot be read; the group's cannot fold into it`);
    const world = multiply(G, multiply(shift(box.x + box.w / 2, box.y + box.h / 2), multiply(mine, shift(-box.w / 2, -box.h / 2))));
    const transform = transformOf(linear(world));
    if (k.tag === 'x-shape' && transform !== null && !/^rotate\([^)]*\)$/.test(transform)) throw new Error('an x-shape takes rotate only; this group’s scale or skew has no form on it');
    const centre = apply(world, { x: box.w / 2, y: box.h / 2 });
    putStyle(plan, k.id, { ...pinToLeftTop(k.style, box), ...sizes, left: px(centre.x - box.w / 2), top: px(centre.y - box.h / 2), transform });
  }
  for (const [id, z] of keys) if (id !== groupId && !kids.some((k) => k.id === id)) put(plan, id, 'z', z);
  commit(doc, slideId, plan, origin);
  return kids.map((k) => k.id);
}

/**
 * A size in % (or anything but px and auto) is a share of the host: moving to another host, it is written as the px
 * it is drawn at (fix wave 2).
 */
function bakedSize(style: Readonly<Record<string, string>>, box: Box): Record<string, string> {
  const out: Record<string, string> = {};
  if (style.width !== undefined && style.width !== 'auto' && pxOf(style.width) === null) out.width = px(box.w);
  if (style.height !== undefined && style.height !== 'auto' && pxOf(style.height) === null) out.height = px(box.h);
  return out;
}

const ROUTES = ['straight', 'hv', 'vh', 'elbow'] as const;
/**
 * A pinned connector's attributes after its host's map `G`: its ends moved, and its route the supported one that draws
 * the moved route exactly (a quarter turn makes `hv` a `vh`); refused when none does (fix wave 2).
 */
export function routedOut(attrs: Readonly<Record<string, string>>, G: ReturnType<typeof shift>): Record<string, string | null> {
  const [x1, y1, x2, y2] = [coordOf(attrs.x1), coordOf(attrs.y1), coordOf(attrs.x2), coordOf(attrs.y2)];
  const moved = connectorRoute(attrs.route, x1, y1, x2, y2).map(([x, y]) => apply(G, { x, y }));
  const [a, b] = [moved[0]!, moved[moved.length - 1]!];
  const same = (route: string) => {
    const drawn = connectorRoute(route, a.x, a.y, b.x, b.y);
    return drawn.length === moved.length && drawn.every(([x, y], i) => Math.abs(x - moved[i]!.x) < 0.01 && Math.abs(y - moved[i]!.y) < 0.01);
  };
  const was = attrs.route ?? 'straight';
  const route = same(was) ? was : ROUTES.find(same);
  if (route === undefined) throw new Error(`the connector's ${was} route has no equal in the dialect once its group's turn is folded in`);
  return { x1: num(a.x), y1: num(a.y), x2: num(b.x), y2: num(b.y), ...(route !== was && { route: route === 'straight' ? null : route }) };
}

// ---------------------------------------------------------------- insert

/** What the Insert menu makes (D8): text, heading, lists, the shape kinds, an icon, an image, a table, a line, a connector. */
export type NewKind = 'text' | 'heading' | 'bullets' | 'numbers' | `shape:${string}` | `icon:${string}` | `image:${string}` | `table:${number}x${number}` | 'line' | 'connector';

const ACCENT = 'var(--ds-color-accent, #2b7a78)';
// a shape starts as the system's raised surface with its hairline edge, which reads on any ground: the accent appears
// once on a slide (the governing system's law), so it is the owner's pick in the fill menu, never a default
const SURFACE = 'background:var(--ds-color-bg-raised, #ffffff); border:2px solid var(--ds-color-border, #e3e2df)';
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
    return `<x-shape kind="${escHtml(arg)}" style="${at(c, w, h)}; width:${w}px; height:${h}px; ${SURFACE}"></x-shape>`;
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
 * stack, flow ones after `after` (else last). An id the slide already holds is re-minted (deep). Refused, unwritten,
 * when the slide it makes would not load. Returns the top-level elements' ids in order.
 */
export function insertElements(doc: Doc, slideId: string, elements: ElementIR[], options: InsertOptions = {}, origin?: unknown): string[] {
  const parent = options.parent ?? ROOT;
  const els = readFlat(doc, slideId, false);
  const eff = resolveParents(els);
  if (parent !== ROOT && !els.some((e) => e.id === parent && CONTAINER_TAGS.has(e.tag))) throw new Error(`${parent} is not a container on ${slideId}`);
  const all = elements.flatMap((e) => [...walk(e)]);
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
  const plan = newPlan();
  for (const f of flat) {
    const e: FlatElement = { ...f };
    if (roots.has(f.id)) {
      e.parent = parent;
      delete e.order;
      delete e.z;
      if (isPinned(e.tag, e.style, e.attrs)) e.z = zKeys.get(f.id)!;
      else e.order = orderKeys.get(f.id)!;
    }
    plan.create.push(e);
  }
  for (const [id, k] of zKeys) if (!roots.has(id)) put(plan, id, 'z', k);
  for (const [id, k] of orderKeys) if (!roots.has(id)) put(plan, id, 'order', k);
  commit(doc, slideId, plan, origin);
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
  const plan = newPlan();
  if ('remove' in op) {
    if (!rows.some((r) => r.id === op.remove)) throw new Error(`${op.remove} is not a row of ${tableId}`);
    if (rows.length <= 1) throw new Error('a table keeps its last row');
    for (const id of [op.remove, ...cellsOf(op.remove).map((c) => c.id)]) plan.remove.add(id);
    commit(doc, slideId, plan, origin);
    return null;
  }
  const ref = rows.find((r) => r.id === op.add);
  if (!ref) throw new Error(`${op.add} is not a row of ${tableId}`);
  const width = cellsOf(ref.id).length;
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
  plan.create.push({ id: rowId, tag: 'tr', parent: tableId, order: keys.get(rowId)!, style: {}, attrs: {} });
  for (let i = 0; i < width; i++) plan.create.push({ id: mintCell(rowId), tag: 'td', parent: rowId, order: cellKeys.get(String(i))!, style: {}, attrs: {}, text: EMPTY_CELL });
  for (const [id, k] of keys) if (id !== rowId) put(plan, id, 'order', k);
  commit(doc, slideId, plan, origin);
  return rowId;
}

/** Adds an empty column after column `add` (0-based; a header row's new cell is a `th`), or removes column `remove`. */
export function tableColumn(doc: Doc, slideId: string, tableId: string, op: { add: number } | { remove: number }, origin?: unknown): void {
  const { els, rows, cellsOf } = tableOf(doc, slideId, tableId);
  const width = Math.max(0, ...rows.map((r) => cellsOf(r.id).length));
  const plan = newPlan();
  if ('remove' in op) {
    if (width <= 1) throw new Error('a table keeps its last column');
    for (const r of rows) {
      const cell = cellsOf(r.id)[op.remove];
      if (cell) plan.remove.add(cell.id);
    }
    commit(doc, slideId, plan, origin);
    return;
  }
  const mintCell = cellMinter(doc, els.map((e) => e.id));
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
    plan.create.push({ id: mintCell(r.id), tag, parent: r.id, order: keys.get(placeholder)!, style: {}, attrs: {}, text: EMPTY_CELL });
    for (const [id, k] of keys) if (id !== placeholder) put(plan, id, 'order', k);
  }
  commit(doc, slideId, plan, origin);
}
