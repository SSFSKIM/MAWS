// P3-C M9 fix wave 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "For Claude"; finding 4): MAWS's
// pinned groups lowered to Claude's form. Claude flattens a pinned `<div>` inside a host (its format.md: "its positioned
// children re-pin to the host (exact for left/top)… it stays only if painted or holding flow content"), so a group's own
// transform (M5's rotated or scaled `div data-group`) would be lost there. The For Claude export lowers it first, as M5's
// ungroup does (writers-elements.ts): each pinned member's pose in the host (the group's placement composed with its own)
// written back as its left, top and transform in the dialect's form (an x-shape takes rotate only: a uniform scale goes
// into its size), a coordinate connector's ends mapped through the group, what the group gave its members (its opacity,
// its inheritable typography) carried by each member itself. The group stays, without its pinned members, only where it
// paints or holds flow content. A group whose geometry is not plain px (a token, a %, a right/bottom pin), or whose pose
// a member cannot take in the dialect, is left as it is (Claude's own flattening keeps its left/top). Bottom up, at every
// level. Portable; over IR whose styles are literal (tokens resolved).
import { appliesTo, PROPS } from '../css';
import { apply, isIdentityLinear, linear, multiply, placement, px, transformMatrix, transformOf, type Affine, type Box } from '../geometry';
import { isPinned, type ElementIR, type Style } from '../ir';

const PX = /^(-?\d+(?:\.\d+)?)px$/;
const pxOf = (v: string | undefined): number | null => {
  const m = PX.exec((v ?? '').trim());
  return m ? Number(m[1]) : null;
};
const COORD = /^(-?\d+(?:\.\d+)?)(px)?$/;
const coordOf = (v: string | undefined): number | null => {
  const m = COORD.exec((v ?? '').trim());
  return m ? Number(m[1]) : null;
};
const num = (n: number) => String(Math.round(n * 100) / 100);
const PAINT = ['background', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'box-shadow'];
const INHERITED = [...PROPS.entries()].filter(([, spec]) => spec.on.includes('inherits')).map(([name]) => name);

const pinned = (el: ElementIR) => isPinned(el.tag, el.style, el.attrs);

/** A member's pose under the group's placement `G`: its new style (or attributes, for a coordinate connector), or null. */
function lowerMember(k: ElementIR, G: Affine, turned: boolean, gx: number, gy: number): ElementIR | null {
  if (k.tag === 'x-connector' && k.attrs.x1 !== undefined) {
    const attrs = { ...k.attrs };
    for (const [x, y] of [['x1', 'y1'], ['x2', 'y2']] as const) {
      const [cx, cy] = [coordOf(k.attrs[x]), coordOf(k.attrs[y])];
      if (cx === null || cy === null) return null; // % of the group: no place in the host
      const p = apply(G, { x: cx, y: cy });
      [attrs[x], attrs[y]] = [num(p.x), num(p.y)];
    }
    return { ...k, attrs };
  }
  if (k.style.right !== undefined || k.style.bottom !== undefined) return null;
  const [x, y, w, h] = [pxOf(k.style.left ?? '0px'), pxOf(k.style.top ?? '0px'), pxOf(k.style.width), pxOf(k.style.height)];
  if (x === null || y === null) return null;
  if (!turned) return { ...k, style: { ...k.style, left: px(x + gx), top: px(y + gy) } };
  if (w === null || h === null) return null; // no size to turn about
  const box: Box = { x, y, w, h };
  const world = multiply(G, placement(box, k.style.transform));
  const centre = apply(world, { x: w / 2, y: h / 2 });
  let size = { w, h };
  let transform: string | null;
  try {
    if (k.tag === 'x-shape') {
      // rotate only: a similarity's uniform scale goes into the box
      const m = linear(world);
      const s = Math.hypot(m.a, m.b);
      if (Math.abs(Math.hypot(m.c, m.d) - s) > 1e-6 || Math.abs(m.a * m.c + m.b * m.d) > 1e-6) return null; // a skew or uneven scale
      size = { w: w * s, h: h * s };
      transform = transformOf({ ...m, a: m.a / s, b: m.b / s, c: m.c / s, d: m.d / s });
    } else transform = transformOf(linear(world));
  } catch {
    return null; // outside the dialect's ranges
  }
  const style: Style = { ...k.style, left: px(centre.x - size.w / 2), top: px(centre.y - size.h / 2), width: px(size.w), height: px(size.h) };
  if (transform) style.transform = transform;
  else delete style.transform;
  return { ...k, style };
}

/** What a group gave a member that the member will no longer get: its opacity, and its inheritable typography it applies to. */
function inherit(k: ElementIR, group: ElementIR, host: ElementIR | null): ElementIR {
  const style = { ...k.style };
  const site = { tag: k.tag, attrs: k.attrs, parent: host ? { tag: host.tag, style: host.style } : { tag: 'section' as const, style: {} } };
  for (const prop of INHERITED) if (group.style[prop] !== undefined && style[prop] === undefined && appliesTo(prop, site, style)) style[prop] = group.style[prop]!;
  const opacity = Number.parseFloat(group.style.opacity ?? '1');
  if (Number.isFinite(opacity) && opacity !== 1) style.opacity = num((Number.parseFloat(style.opacity ?? '1') || 1) * opacity);
  return { ...k, style };
}

/** One pinned div lowered into its host: what replaces it there (itself, kept, first; then its members), or null. */
function lowerGroup(group: ElementIR, host: ElementIR | null): ElementIR[] | null {
  const members = group.children.filter(pinned);
  if (!members.length) return null;
  if (group.style.right !== undefined || group.style.bottom !== undefined) return null;
  const [gx, gy] = [pxOf(group.style.left ?? '0px'), pxOf(group.style.top ?? '0px')];
  if (gx === null || gy === null) return null;
  const turned = group.style.transform !== undefined && !isIdentityLinear(transformMatrix(group.style.transform, 1, 1));
  const [gw, gh] = [pxOf(group.style.width), pxOf(group.style.height)];
  if (turned && (gw === null || gh === null)) return null;
  const G = placement({ x: gx, y: gy, w: gw ?? 0, h: gh ?? 0 }, turned ? group.style.transform : undefined);
  const lifted: ElementIR[] = [];
  for (const k of members) {
    const posed = lowerMember(k, G, turned, gx, gy);
    if (!posed) return null; // one member that cannot take its pose: the group stays whole
    lifted.push(inherit(posed, group, host));
  }
  const flow = group.children.filter((c) => !pinned(c));
  const paints = PAINT.some((p) => group.style[p] !== undefined);
  return [...(paints || flow.length ? [{ ...group, children: flow }] : []), ...lifted];
}

/** A container's children with every pinned div holding pinned children lowered into it, bottom up. */
export function lowerGroups(children: ElementIR[], host: ElementIR | null = null): ElementIR[] {
  return children.flatMap((el) => {
    const inner = el.children.length ? { ...el, children: lowerGroups(el.children, el) } : el;
    if (inner.tag !== 'div' || !pinned(inner)) return [inner];
    return lowerGroup(inner, host) ?? [inner];
  });
}
