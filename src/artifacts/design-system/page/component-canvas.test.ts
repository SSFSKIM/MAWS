// UX wave U10b, M11 (docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md, §J; l6-artifacts-15): the canvas a
// canon component is drawn on. The table names every component of the three bundled systems and nothing else; a
// component it does not name takes the largest canvas; the rule the table follows (the smallest canvas on which the
// frame's children's margin boxes fit inside the inset with 8 px to spare) is the one the measuring scene of
// e2e/design-systems.spec.ts applies outside the sandbox.
import { describe, expect, it } from 'vitest';
import { canonKind } from '../canon';
import { DEFAULT_SYSTEMS } from '../../types/design_system/defaults';
import { BUNDLED_COMPONENT_CANVASES, CANVAS_SPARE, COMPONENT_CANVASES, componentCanvas, componentFrameCss, holds, insetOf, smallestHolding, type ContentBox } from './component-canvas';

const [SMALL, MIDDLE, LARGE] = COMPONENT_CANVASES;

// A component's content as the frame draws it: one block the width of the canvas less the inset, `height` tall, centred
// (the frame's `justify-content: safe center`).
function centred(canvas: (typeof COMPONENT_CANVASES)[number], height: number): ContentBox {
  const inset = insetOf(canvas);
  const top = inset + Math.max(0, (canvas.height - 2 * inset - height) / 2);
  return { top, bottom: top + height, left: inset, right: canvas.width - inset };
}

describe('the component canvases (§J)', () => {
  it('are three of one aspect, the smallest first, each inset by a fifteenth of its width: 64 px at 960', () => {
    expect(COMPONENT_CANVASES.map(({ width, height }) => [width, height])).toEqual([
      [960, 540],
      [1120, 630],
      [1280, 720],
    ]);
    expect(insetOf(SMALL)).toBe(64);
    expect(insetOf(MIDDLE)).toBeCloseTo(74.667, 3);
    expect(insetOf(LARGE)).toBeCloseTo(85.333, 3);
    expect(CANVAS_SPARE).toBe(8);
  });

  it('names every component of the three bundled systems, and nothing the bundle does not hold', () => {
    const bundled = Object.fromEntries(
      DEFAULT_SYSTEMS.map((system) => [system.key, Object.keys(system.files).filter((path) => canonKind(path) === 'component').sort()]),
    );
    const named = Object.fromEntries(Object.entries(BUNDLED_COMPONENT_CANVASES).map(([key, table]) => [key, Object.keys(table).sort()]));
    expect(named).toEqual(bundled);
    expect(Object.keys(named).sort()).toEqual(['classroom', 'maws', 'official']);
    for (const [key, table] of Object.entries(BUNDLED_COMPONENT_CANVASES)) {
      for (const [path, canvas] of Object.entries(table)) {
        expect(COMPONENT_CANVASES, `${key}/${path} is on one of the three canvases`).toContain(canvas);
        expect(componentCanvas(key, path)).toBe(canvas);
      }
    }
  });

  it('gives a component the table does not name the largest canvas, whatever the system or the path', () => {
    expect(componentCanvas('classroom', 'components/chip.html')).toBe(LARGE);
    expect(componentCanvas('harbor', 'components/data-table.html')).toBe(LARGE);
    expect(componentCanvas('', 'components/status.html')).toBe(LARGE);
    for (const key of ['__proto__', 'constructor', 'toString']) expect(componentCanvas(key, 'components/status.html')).toBe(LARGE);
    expect(componentCanvas('maws', '__proto__')).toBe(LARGE);
  });

  it('holds a component whose margin boxes leave at least 8 px of the canvas less its inset, and fit inside it sideways', () => {
    const inner = SMALL.height - 2 * insetOf(SMALL); // 412
    expect(holds(SMALL, centred(SMALL, inner - CANVAS_SPARE))).toBe(true);
    expect(holds(SMALL, centred(SMALL, inner - CANVAS_SPARE + 0.1))).toBe(false);
    expect(holds(SMALL, centred(SMALL, inner + 20))).toBe(false); // over: aligned to the top (safe center), cut at the foot
    // sideways: a block the inset's width holds (to a sub-pixel); one wider than it does not
    expect(holds(SMALL, { ...centred(SMALL, 100), right: SMALL.width - 64 + 0.01 })).toBe(true);
    expect(holds(SMALL, { ...centred(SMALL, 100), right: SMALL.width - 60 })).toBe(false);
    expect(holds(SMALL, { ...centred(SMALL, 100), left: 60 })).toBe(false);
  });

  it('chooses the smallest canvas that holds the component, the largest when none does: the drawn page’s readings (page 6)', () => {
    // Classroom's data table: 540 px of 412 at 960, 482 of 480.7 at 1,120, 308 of 549.3 at 1,280
    expect(smallestHolding([centred(SMALL, 540), centred(MIDDLE, 482), centred(LARGE, 308)])).toBe(LARGE);
    // Official's signature: 404.9 px at every width, 7.1 px to spare at 960, short of the 8 the rule asks
    expect(smallestHolding([centred(SMALL, 404.9), centred(MIDDLE, 404.9), centred(LARGE, 404.9)])).toBe(MIDDLE);
    // the house table: 394 of 412 at 960, 18 to spare
    expect(smallestHolding([centred(SMALL, 394), centred(MIDDLE, 380), centred(LARGE, 360)])).toBe(SMALL);
    // a component no canvas holds is drawn on the largest, where it is cut least
    expect(smallestHolding([centred(SMALL, 900), centred(MIDDLE, 900), centred(LARGE, 900)])).toBe(LARGE);
  });

  it('writes the frame’s own canvas: its size, its inset as padding, the content centred and cut at the canvas', () => {
    const css = componentFrameCss(MIDDLE);
    expect(css).toContain('width: 1120px; height: 630px; overflow: hidden;');
    expect(css).toContain(`padding: ${insetOf(MIDDLE)}px;`);
    expect(css).toContain('justify-content: safe center;');
    expect(componentFrameCss(SMALL)).not.toBe(css);
  });
});
