// P3-C M4 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Canvas"): the geometry the canvas draws the
// dialect's own elements with: x-shape outlines filling their box, the thirty x-icon glyphs, x-connector routes and heads.
import { describe, expect, it } from 'vitest';
import { connectorRoute, headPolygon, ICON_GLYPHS, shapePath, splitBorder } from './glyphs';
import { ICON_NAMES } from './parse';

const numbers = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

describe('x-shape outlines', () => {
  it.each(['rect', 'rounded', 'ellipse', 'diamond', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'line'])('%s stays inside its box', (kind) => {
    const d = shapePath(kind, 200, 100, 0);
    expect(d.length).toBeGreaterThan(0);
    const xy = numbers(d.replace(/A [^ML]*?(?= [ML]|$)/g, ''));
    for (let i = 0; i + 1 < xy.length; i += 2) {
      expect(xy[i]).toBeGreaterThanOrEqual(0);
      expect(xy[i]).toBeLessThanOrEqual(200);
      expect(xy[i + 1]).toBeGreaterThanOrEqual(0);
      expect(xy[i + 1]).toBeLessThanOrEqual(100);
    }
  });

  it('an arrow’s head is the last 40 % of its length', () => {
    expect(shapePath('arrow-right', 100, 50, 0)).toContain('L 60 0');
    expect(shapePath('arrow-down', 50, 100, 0)).toContain('L 0 60');
  });

  it('a stroke is drawn inside the box (half its width in from each edge)', () => {
    expect(shapePath('ellipse', 100, 50, 4)).toBe('M 2 25 A 48 23 0 1 0 98 25 A 48 23 0 1 0 2 25 Z');
  });
});

describe('x-icon glyphs', () => {
  it('draws every one of the dialect’s thirty names, and nothing else', () => {
    expect(Object.keys(ICON_GLYPHS).sort()).toEqual([...ICON_NAMES].sort());
    for (const d of Object.values(ICON_GLYPHS)) expect(d).toMatch(/^M /);
  });
});

describe('x-connector routes and heads', () => {
  it('routes straight, across then down, down then across, and elbow at the longer run’s midpoint', () => {
    expect(connectorRoute('straight', 0, 0, 100, 50)).toEqual([[0, 0], [100, 50]]);
    expect(connectorRoute('hv', 0, 0, 100, 50)).toEqual([[0, 0], [100, 0], [100, 50]]);
    expect(connectorRoute('vh', 0, 0, 100, 50)).toEqual([[0, 0], [0, 50], [100, 50]]);
    expect(connectorRoute('elbow', 0, 0, 100, 50)).toEqual([[0, 0], [50, 0], [50, 50], [100, 50]]);
    expect(connectorRoute('elbow', 0, 0, 40, 200)).toEqual([[0, 0], [0, 100], [40, 100], [40, 200]]);
  });

  it('a head is a constant size, about four stroke widths, pointing along the last leg', () => {
    const tip: [number, number] = [100, 0];
    const head = headPolygon([0, 0], tip, 2);
    expect(head[0]).toEqual(tip);
    expect(head[1]![0]).toBeCloseTo(92);
    expect(Math.abs(head[1]![1] - head[2]![1])).toBeCloseTo(8);
  });

  it('reads a border shorthand into width, style and colour, a token kept whole', () => {
    expect(splitBorder('3px dashed var(--ds-color-accent, #2b7a78)')).toEqual({ width: '3px', style: 'dashed', color: 'var(--ds-color-accent, #2b7a78)' });
    expect(splitBorder('solid')).toEqual({ width: null, style: 'solid', color: null });
  });
});
