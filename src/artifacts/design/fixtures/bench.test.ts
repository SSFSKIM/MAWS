// P3-E1 M6: the scale gate's 24-board design is E0's exact mix, a valid manifest, and every board file loads in C's loader
// with no hold, its element count what the gate expects each canvas to draw.
import { describe, expect, it } from 'vitest';
import { loadSlide } from '../../slides/parse';
import type { ElementIR } from '../../slides/ir';
import { boardPath, CANVAS_PATH, parseCanvasJson } from '../canvas';
import { BENCH_CARD, BENCH_CARD_FILLS, BENCH_MIX, benchBoardHtml, benchBoards, benchDesignFiles } from './bench';

const count = (children: ElementIR[]): number => children.reduce((n, c) => n + 1 + count(c.children), 0);
const find = (children: ElementIR[], id: string): ElementIR | undefined => {
  for (const c of children) {
    if (c.id === id) return c;
    const inner = find(c.children, id);
    if (inner) return inner;
  }
  return undefined;
};

describe('the 24-board bench design', () => {
  const boards = benchBoards();
  const files = benchDesignFiles();

  it('is E0’s mix: six phones, five tablets, five desktops, four slides, two posters, one 4,096² and one 4,096×8,192', () => {
    expect(boards).toHaveLength(24);
    const sizes = (w: number, h: number) => boards.filter((b) => b.w === w && b.h === h).length;
    expect([sizes(390, 844), sizes(834, 1194), sizes(1440, 1024), sizes(1920, 1080), sizes(1080, 8192), sizes(4096, 4096), sizes(4096, 8192)]).toEqual([6, 5, 5, 4, 2, 1, 1]);
    expect(boards.map((b) => b.size)).toEqual(BENCH_MIX);
    expect(new Set(boards.map((b) => b.id)).size).toBe(24);
  });

  it('lays the boards out without overlap, and its manifest parses with every frame and the order', () => {
    for (const [i, a] of boards.entries())
      for (const b of boards.slice(i + 1)) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} and ${b.id}`).toBe(true);
    const parsed = parseCanvasJson(files[CANVAS_PATH]!);
    if (!parsed.ok) throw new Error(parsed.problems.join('; '));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.canvas.order).toEqual(boards.map((b) => b.id));
    for (const b of boards) expect(parsed.canvas.boards[b.id]).toMatchObject({ x: b.x, y: b.y, w: b.w, h: b.h, title: b.title });
    expect(Object.keys(files).sort()).toEqual([CANVAS_PATH, ...boards.map((b) => boardPath(b.id))].sort());
  });

  it('loads every board file with no hold and no diagnostic, its element count as recorded, the large boards near 180 elements', () => {
    for (const b of boards) {
      const loaded = loadSlide(files[boardPath(b.id)]!, { fileId: b.id });
      if (!loaded.ok) throw new Error(`${b.id}: ${loaded.held.reasons.join('; ')}`);
      expect(loaded.diagnostics, b.id).toEqual([]);
      expect(count(loaded.slide.children), b.id).toBe(b.elements);
      expect(b.elements, b.id).toBeLessThanOrEqual(200);
      expect(find(loaded.slide.children, BENCH_CARD)?.style.background, b.id).toBe(BENCH_CARD_FILLS[0]);
    }
    expect(Math.max(...boards.map((b) => b.elements))).toBeGreaterThanOrEqual(170);
  });

  it('restyles only its first card when given the other fill', () => {
    const [plain, other] = [benchBoardHtml('b01', 390, 844, 0), benchBoardHtml('b01', 390, 844, 0, BENCH_CARD_FILLS[1])];
    expect(other.elements).toBe(plain.elements);
    const loaded = loadSlide(other.html, { fileId: 'b01' });
    if (!loaded.ok) throw new Error(loaded.held.reasons.join('; '));
    expect(find(loaded.slide.children, 'c0')?.style.background).toBe(BENCH_CARD_FILLS[1]);
    expect(find(loaded.slide.children, 'c1')?.style.background).toBe(BENCH_CARD_FILLS[0]);
  });
});
