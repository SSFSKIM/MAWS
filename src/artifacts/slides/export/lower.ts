// P3-C M9 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "For Claude"; fix waves 1 and 2): MAWS's pinned
// groups lowered to Claude's form. Claude flattens a pinned `<div>` inside a host (its format.md: "its positioned children
// re-pin to the host (exact for left/top; for right/bottom/centering only when it has a set size — else an error)… it
// stays only if painted or holding flow content"), so a group's own transform (M5's rotated or scaled `div data-group`),
// and any member placed other than by left/top px, would be lost or refused there. The For Claude export lowers every
// such div itself, bottom up, at every level, each pinned member's pose in the host written back as its own left, top,
// width, height and transform in the dialect's form:
// - from the model where it can be (the group placed by px left/top, sized in px when it transforms; the member placed by
//   px left/top, sized in px when the pose turns it): the group's whole placement (its translation included) composed
//   with the member's, exactly, as M5's ungroup composes it (writers-elements.ts);
// - else from the export window's measure (a member auto-sized, placed in %, pinned right or bottom; a group placed so):
//   the member's drawn pose re-expressed in the host's padding box (`MeasureNeeded` asks the caller for the measure);
// - an x-shape takes rotate only, so a uniform scale goes into its size; a coordinate connector's ends map through the
//   group (% of its padding box);
// - a pose the dialect cannot write (a skew or scale out of its ranges, a mirror, an x-shape skewed) refuses the export,
//   naming the slide, the group and the member: never a silent loss.
// A lifted member carries what it would have inherited from the group: the group's opacity (multiplied into its own) and
// the inheritable typography the dialect takes on it, but never what its own tag sets by default (h1 to h3 their size,
// weight and line height; a header cell its weight and alignment; a cell its alignment; CANVAS_CSS's defaults).
// The group stays, without its pinned members, only where it paints or holds flow content. Portable; over IR whose
// styles are literal (tokens resolved).
import { appliesTo, PROPS } from '../css';
import { apply, IDENTITY, invert, isIdentityLinear, linear, multiply, placement, px, shift, transformMatrix, transformOf, type Affine } from '../geometry';
import { isPinned, type ElementIR, type Style } from '../ir';
import type { MeasuredElement } from './measure';

/** The model cannot place a member: the caller measures the deck in the export window and lowers again with the measure. */
export class MeasureNeeded extends Error {
  constructor(where: string) {
    super(`${where}: its place needs the export window's measure`);
  }
}

export interface LowerContext {
  slideId: string;
  /** The export window's measure of this slide, by element id; null before it is taken. */
  measured: ReadonlyMap<string, MeasuredElement> | null;
}

const PX = /^(-?\d+(?:\.\d+)?)px$/;
const pxOf = (v: string | undefined): number | null => {
  const m = PX.exec((v ?? '').trim());
  return m ? Number(m[1]) : null;
};
const COORD = /^(-?\d+(?:\.\d+)?)(px|%)?$/;
const num = (n: number) => String(Math.round(n * 100) / 100);
const PAINT = ['background', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'box-shadow'];
const INHERITED = [...PROPS.entries()].filter(([, spec]) => spec.on.includes('inherits')).map(([name]) => name);
// What a tag sets itself (CANVAS_CSS), so a group's value never reached it by inheritance.
const TAG_OWN: Readonly<Record<string, readonly string[]>> = {
  h1: ['font-size', 'font-weight', 'line-height'],
  h2: ['font-size', 'font-weight', 'line-height'],
  h3: ['font-size', 'font-weight', 'line-height'],
  th: ['font-weight', 'text-align'],
  td: ['text-align'],
};

const pinned = (el: ElementIR) => isPinned(el.tag, el.style, el.attrs);
const isConnector = (k: ElementIR) => k.tag === 'x-connector' && k.attrs.x1 !== undefined;

/** A refusal: the slide, the group and the member, and why. */
const refuse = (ctx: LowerContext | undefined, group: ElementIR, k: ElementIR, reason: string): never => {
  throw new Error(`slide ${ctx?.slideId ?? '?'}, group ${group.id}, member ${k.id}: ${reason}`);
};

/** A pose (`world`: the member's local px → host px) as the member's own style: left, top, width, height, transform. */
function poseStyle(k: ElementIR, world: Affine, w: number, h: number, refusal: (reason: string) => never): Style {
  const centre = apply(world, { x: w / 2, y: h / 2 });
  let size = { w, h };
  let transform: string | null;
  try {
    if (k.tag === 'x-shape') {
      // rotate only: a similarity's uniform scale goes into the box
      const m = linear(world);
      const s = Math.hypot(m.a, m.b);
      if (Math.abs(Math.hypot(m.c, m.d) - s) > 1e-6 || Math.abs(m.a * m.c + m.b * m.d) > 1e-6) return refusal('an x-shape takes rotate only, and this pose skews or scales it unevenly');
      size = { w: w * s, h: h * s };
      transform = transformOf({ ...m, a: m.a / s, b: m.b / s, c: m.c / s, d: m.d / s });
    } else transform = transformOf(linear(world));
  } catch (error) {
    return refusal((error as Error).message);
  }
  const style: Style = { ...k.style, left: px(centre.x - size.w / 2), top: px(centre.y - size.h / 2), width: px(size.w), height: px(size.h) };
  delete style.right;
  delete style.bottom;
  if (transform) style.transform = transform;
  else delete style.transform;
  return style;
}

/** The group's placement in its host from the model (local px → host px), or null when it is not placed in px. */
function modelPlacement(group: ElementIR): { G: Affine; w: number | null; h: number | null } | null {
  if (group.style.right !== undefined || group.style.bottom !== undefined) return null;
  const [gx, gy] = [pxOf(group.style.left ?? '0px'), pxOf(group.style.top ?? '0px')];
  if (gx === null || gy === null) return null;
  const [w, h] = [pxOf(group.style.width), pxOf(group.style.height)];
  const t = group.style.transform;
  if (t === undefined) return { G: shift(gx, gy), w, h };
  if (w === null || h === null) {
    // its transform's % and its centre need its size; a translation in px alone does not
    const probe = transformMatrix(t, 1, 1);
    if (!isIdentityLinear(probe) || t.includes('%')) return null;
    return { G: multiply(shift(gx, gy), probe), w, h };
  }
  return { G: placement({ x: gx, y: gy, w, h }, t), w, h };
}

/** A member lowered from the model under the group's placement; null when the model cannot place it. */
function modelMember(k: ElementIR, group: ElementIR, model: NonNullable<ReturnType<typeof modelPlacement>>, refusal: (reason: string) => never): ElementIR | null {
  const { G } = model;
  if (isConnector(k)) {
    const attrs = { ...k.attrs };
    for (const [x, y] of [['x1', 'y1'], ['x2', 'y2']] as const) {
      const [mx, my] = [COORD.exec((k.attrs[x] ?? '').trim()), COORD.exec((k.attrs[y] ?? '').trim())];
      if (!mx || !my) return null;
      if ((mx[2] === '%' && model.w === null) || (my[2] === '%' && model.h === null)) return null;
      const local = { x: mx[2] === '%' ? (Number(mx[1]) / 100) * model.w! : Number(mx[1]), y: my[2] === '%' ? (Number(my[1]) / 100) * model.h! : Number(my[1]) };
      const p = apply(G, local);
      [attrs[x], attrs[y]] = [num(p.x), num(p.y)];
    }
    return { ...k, attrs };
  }
  if (k.style.right !== undefined || k.style.bottom !== undefined) return null;
  const [x, y, w, h] = [pxOf(k.style.left ?? '0px'), pxOf(k.style.top ?? '0px'), pxOf(k.style.width), pxOf(k.style.height)];
  if (x === null || y === null) return null;
  const own = k.style.transform;
  if (isIdentityLinear(G) && own === undefined) {
    // a translation alone: the member moves, its size (auto or not) untouched
    const p = apply(G, { x, y });
    return { ...k, style: { ...k.style, left: px(p.x), top: px(p.y) } };
  }
  if (w === null || h === null) return null; // no size to turn about
  return { ...k, style: poseStyle(k, multiply(G, placement({ x, y, w, h }, own)), w, h, refusal) };
}

/** An element's drawn placement from the measure: its local px (layout box, border box) → slide px. */
function drawn(m: MeasuredElement): { W: Affine; w: number; h: number } {
  const [a, b, c, d] = m.linear ?? [1, 0, 0, 1];
  const sx = Math.hypot(a, b) || 1;
  const sy = Math.abs(a * d - b * c) / sx || 1;
  const [w, h] = [m.box.w / sx, m.box.h / sy];
  const centre = { x: m.box.x + m.box.w / 2, y: m.box.y + m.box.h / 2 };
  return { W: multiply(shift(centre.x, centre.y), multiply({ a, b, c, d, e: 0, f: 0 }, shift(-w / 2, -h / 2))), w, h };
}
/** A host's padding box (where its pinned children are placed) → slide px; the section's is the slide's own. */
function paddingBox(host: ElementIR | null, ctx: LowerContext): Affine | null {
  if (!host) return IDENTITY;
  const m = ctx.measured?.get(host.id);
  if (!m) return null;
  return multiply(drawn(m).W, shift(m.paint.borders[3]?.width ?? 0, m.paint.borders[0]?.width ?? 0));
}

/** A member lowered from the window's measure, re-expressed in the host's padding box. */
function measuredMember(k: ElementIR, group: ElementIR, host: ElementIR | null, ctx: LowerContext | undefined, refusal: (reason: string) => never): ElementIR {
  if (!ctx?.measured) throw new MeasureNeeded(`slide ${ctx?.slideId ?? '?'}, group ${group.id}, member ${k.id}`);
  const H = paddingBox(host, ctx);
  if (!H) return refusal('its host was not measured');
  const toHost = invert(H);
  if (isConnector(k)) {
    const g = ctx.measured.get(group.id);
    if (!g) return refusal('its group was not measured');
    const { W, w, h } = drawn(g);
    const [bl, bt, br, bb] = [g.paint.borders[3]?.width ?? 0, g.paint.borders[0]?.width ?? 0, g.paint.borders[1]?.width ?? 0, g.paint.borders[2]?.width ?? 0];
    const inner = multiply(W, shift(bl, bt));
    const attrs = { ...k.attrs };
    for (const [x, y] of [['x1', 'y1'], ['x2', 'y2']] as const) {
      const [mx, my] = [COORD.exec((k.attrs[x] ?? '').trim()), COORD.exec((k.attrs[y] ?? '').trim())];
      if (!mx || !my) return refusal(`its ${x}/${y} cannot be read`);
      const local = { x: mx[2] === '%' ? (Number(mx[1]) / 100) * (w - bl - br) : Number(mx[1]), y: my[2] === '%' ? (Number(my[1]) / 100) * (h - bt - bb) : Number(my[1]) };
      const p = apply(toHost, apply(inner, local));
      [attrs[x], attrs[y]] = [num(p.x), num(p.y)];
    }
    return { ...k, attrs };
  }
  const m = ctx.measured.get(k.id);
  if (!m) return refusal('it was not measured (is it drawn?)');
  const { W, w, h } = drawn(m);
  return { ...k, style: poseStyle(k, multiply(toHost, W), w, h, refusal) };
}

/** What a group gave a member that the member will no longer get from it. */
function inherit(k: ElementIR, group: ElementIR, host: ElementIR | null): ElementIR {
  const style = { ...k.style };
  const site = { tag: k.tag, attrs: k.attrs, parent: host ? { tag: host.tag, style: host.style } : { tag: 'section' as const, style: {} } };
  const own = TAG_OWN[k.tag] ?? [];
  for (const prop of INHERITED) {
    if (group.style[prop] === undefined || style[prop] !== undefined || own.includes(prop)) continue;
    if (appliesTo(prop, site, style)) style[prop] = group.style[prop]!;
  }
  const opacity = Number.parseFloat(group.style.opacity ?? '1');
  if (Number.isFinite(opacity) && opacity !== 1) {
    const mine = Number.parseFloat(style.opacity ?? '1');
    style.opacity = num((Number.isFinite(mine) ? mine : 1) * opacity);
  }
  return { ...k, style };
}

/** One pinned div lowered into its host: what replaces it there (itself, kept, first; then its members); null without pinned members. */
function lowerGroup(group: ElementIR, host: ElementIR | null, ctx: LowerContext | undefined): ElementIR[] | null {
  const members = group.children.filter(pinned);
  if (!members.length) return null;
  const model = modelPlacement(group);
  const lifted = members.map((k) => {
    const refusal = (reason: string) => refuse(ctx, group, k, reason);
    const posed = (model && modelMember(k, group, model, refusal)) ?? measuredMember(k, group, host, ctx, refusal);
    return inherit(posed, group, host);
  });
  const flow = group.children.filter((c) => !pinned(c));
  const paints = PAINT.some((p) => group.style[p] !== undefined);
  return [...(paints || flow.length ? [{ ...group, children: flow }] : []), ...lifted];
}

/**
 * A container's children with every pinned div holding pinned children lowered into it, bottom up. Throws
 * `MeasureNeeded` when a member's place needs the window's measure and `ctx.measured` is null, and a refusal naming the
 * slide, the group and the member when the dialect cannot write a member's pose.
 */
export function lowerGroups(children: ElementIR[], host: ElementIR | null = null, ctx?: LowerContext): ElementIR[] {
  return children.flatMap((el) => {
    const inner = el.children.length ? { ...el, children: lowerGroups(el.children, el, ctx) } : el;
    if (inner.tag !== 'div' || !pinned(inner)) return [inner];
    return lowerGroup(inner, host, ctx) ?? [inner];
  });
}
