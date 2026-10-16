// P3-C M9 fix wave 2 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "For Claude"; findings 2 and 3): a
// pinned group lowered into its host keeps every member's pose: a translation-only group's translation; an auto-sized or
// right-pinned member's place, read from the export window's measure; a pose the dialect cannot write refuses the
// export, naming the group and the member. What a lifted member carries is what it would have inherited: an opacity of 0
// stays 0, and a heading keeps its own size, weight and line height.
import { describe, expect, it } from 'vitest';
import { cornersOf, multiply, placement, shift, type Box } from '../geometry';
import type { ElementIR } from '../ir';
import { lowerGroups, MeasureNeeded } from './lower';
import { measuredAt } from './deck.test-support';

const el = (id: string, tag: ElementIR['tag'], style: Record<string, string>, children: ElementIR[] = [], attrs: Record<string, string> = {}): ElementIR => ({ id, tag, style, attrs, children });
const group = (style: Record<string, string>, members: ElementIR[]) => el('grp', 'div', { position: 'absolute', ...style }, members, { 'data-group': '' });
const near = (a: { x: number; y: number }[], b: { x: number; y: number }[]) => a.every((p, i) => Math.hypot(p.x - b[i]!.x, p.y - b[i]!.y) < 0.6);
const boxOf = (k: ElementIR): Box => ({ x: parseFloat(k.style.left!), y: parseFloat(k.style.top!), w: parseFloat(k.style.width!), h: parseFloat(k.style.height!) });

const rad = (deg: number) => (deg * Math.PI) / 180;

describe('lowering a group into its host', () => {
  it('keeps a translation-only group’s translation (finding 2)', () => {
    const [p] = lowerGroups([group({ left: '100px', top: '50px', transform: 'translate(30px, 40px)' }, [el('p', 'p', { position: 'absolute', left: '10px', top: '20px' })])]);
    expect(p!.style).toMatchObject({ left: '140px', top: '110px' });
    expect(p!.style.width).toBeUndefined(); // an auto-sized member stays auto-sized
  });

  it('needs the window’s measure for an auto-sized or right-pinned member of a turned group, and keeps its pose with it', () => {
    const G = placement({ x: 600, y: 300, w: 400, h: 200 }, 'rotate(30deg)');
    const auto = el('auto', 'p', { position: 'absolute', left: '20px', top: '10px', 'font-size': '32px' });
    const pinnedRight = el('right', 'div', { position: 'absolute', right: '20px', bottom: '30px', width: '100px', height: '50px', background: '#ff0000' });
    const tree = () => [group({ left: '600px', top: '300px', width: '400px', height: '200px', transform: 'rotate(30deg)' }, [auto, pinnedRight])];
    expect(() => lowerGroups(tree())).toThrow(MeasureNeeded);
    // the window's measure: the auto-sized text 180 × 45, the right-pinned box at 400 − 20 − 100, 200 − 30 − 50
    const W = { auto: multiply(G, shift(20, 10)), right: multiply(G, shift(280, 120)) };
    const measured = new Map([
      ['grp', measuredAt('grp', 'div', G, 400, 200)],
      ['auto', measuredAt('auto', 'p', W.auto, 180, 45)],
      ['right', measuredAt('right', 'div', W.right, 100, 50)],
    ]);
    const [a, r] = lowerGroups(tree(), null, { measured, slideId: 's' });
    expect(a!.style.transform).toBe('rotate(30deg)');
    expect(near(cornersOf(placement(boxOf(a!), a!.style.transform), 180, 45), cornersOf(W.auto, 180, 45))).toBe(true);
    expect(r!.style.right).toBeUndefined();
    expect(near(cornersOf(placement(boxOf(r!), r!.style.transform), 100, 50), cornersOf(W.right, 100, 50))).toBe(true);
  });

  it('refuses a pose the dialect cannot write, naming the group and the member', () => {
    const shape = el('blob', 'x-shape', { position: 'absolute', left: '0px', top: '0px', width: '100px', height: '100px' }, [], { kind: 'ellipse' });
    expect(() => lowerGroups([group({ left: '0px', top: '0px', width: '200px', height: '200px', transform: `skewX(30deg) rotate(${rad(0)}deg)` }, [shape])], null, { slideId: 's1', measured: null })).toThrow(/slide s1, group grp, member blob: .*rotate only/);
  });

  it('carries what a member inherited: an opacity of 0 stays 0; a heading keeps its own size, weight and line height (finding 3)', () => {
    const lifted = lowerGroups([
      group({ left: '0px', top: '0px', opacity: '0.5', color: '#ff0000', 'font-size': '40px', 'font-weight': '700', 'line-height': '2' }, [
        el('ghost', 'p', { position: 'absolute', left: '0px', top: '0px', opacity: '0' }),
        el('head', 'h2', { position: 'absolute', left: '0px', top: '100px' }),
        el('body', 'p', { position: 'absolute', left: '0px', top: '200px' }),
      ]),
    ]);
    const [ghost, head, body] = lifted as [ElementIR, ElementIR, ElementIR];
    expect(ghost.style.opacity).toBe('0');
    expect(head.style).toMatchObject({ color: '#ff0000', opacity: '0.5' });
    expect([head.style['font-size'], head.style['font-weight'], head.style['line-height']]).toEqual([undefined, undefined, undefined]);
    expect(body.style).toMatchObject({ 'font-size': '40px', 'font-weight': '700', 'line-height': '2', color: '#ff0000' });
  });
});

// The final review's A6 and A8: each a regression of a code-traced finding.
describe('lowering a group into its host: the final review', () => {
  const wire = (attrs: Record<string, string>) => el('wire', 'x-connector', {}, [], attrs);
  const sized = { left: '100px', top: '100px', width: '200px', height: '100px' };

  it('A6: rewrites a connector’s route with its ends: a quarter turn makes hv a vh (from the model)', () => {
    const [w] = lowerGroups([group({ ...sized, transform: 'rotate(90deg)' }, [wire({ x1: '0', y1: '50', x2: '200', y2: '100', route: 'hv' })])]);
    // (0, 50) (200, 50) (200, 100) about the centre (200, 150): (200, 50) (200, 250) (150, 250)
    expect(w!.attrs).toEqual({ x1: '200', y1: '50', x2: '150', y2: '250', route: 'vh' });
  });

  it('A6: rewrites the route from the window’s measure too, and keeps % ends of the group’s box', () => {
    const G = placement({ x: 100, y: 100, w: 200, h: 100 }, 'rotate(90deg)');
    const tree = [group({ right: '0px', bottom: '0px', width: '200px', height: '100px', transform: 'rotate(90deg)' }, [wire({ x1: '0%', y1: '50%', x2: '100%', y2: '100%', route: 'hv' })])];
    expect(() => lowerGroups(tree)).toThrow(MeasureNeeded);
    const [w] = lowerGroups(tree, null, { slideId: 's', measured: new Map([['grp', measuredAt('grp', 'div', G, 200, 100)]]) });
    expect(w!.attrs).toEqual({ x1: '200', y1: '50', x2: '150', y2: '250', route: 'vh' });
  });

  it('A6: refuses a routed connector a turn off the quarters would bend, naming the group and the member; a straight one turns', () => {
    expect(() => lowerGroups([group({ ...sized, transform: 'rotate(30deg)' }, [wire({ x1: '0', y1: '50', x2: '200', y2: '100', route: 'hv' })])], null, { slideId: 's1', measured: null })).toThrow(/slide s1, group grp, member wire: .*route/);
    const [w] = lowerGroups([group({ ...sized, transform: 'rotate(30deg)' }, [wire({ x1: '0', y1: '50', x2: '200', y2: '50' })])]);
    expect(w!.attrs.route).toBeUndefined();
  });

  it('A8: drops a hidden group whole rather than lifting its members into view', () => {
    const hidden = group({ ...sized, display: 'none' }, [el('p', 'p', { position: 'absolute', left: '10px', top: '20px' }), el('r', 'p', { position: 'absolute', right: '0px', top: '0px' })]);
    expect(lowerGroups([hidden], null, { slideId: 's', measured: null })).toEqual([]);
    // inside a visible group, the hidden one goes, its sibling lifts
    const outer = el('outer', 'div', { position: 'absolute', left: '0px', top: '0px' }, [{ ...hidden, id: 'inner' }, el('q', 'p', { position: 'absolute', left: '5px', top: '5px' })], { 'data-group': '' });
    expect(lowerGroups([outer]).map((k) => k.id)).toEqual(['q']);
  });
});
