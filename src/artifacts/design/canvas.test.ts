// P3-E1 M1 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md): the design's manifest, project/canvas.json:
// its paths and limits, the loader that refuses an invalid frame rather than clamping it, and one canonical file that
// keeps every key it does not read.
import { describe, expect, it } from 'vitest';
import { boardIdOf, boardPath, CANVAS_LIMITS, CANVAS_PATH, frameProblems, parseCanvasJson, serializeCanvasJson, type CanvasJson } from './canvas';

function parse(json: unknown): { canvas: CanvasJson; messages: string[] } {
  const r = parseCanvasJson(typeof json === 'string' ? json : JSON.stringify(json));
  if (!r.ok) throw new Error(r.problems.join('; '));
  return { canvas: r.canvas, messages: r.diagnostics.map((d) => `${d.severity} ${d.property}: ${d.message}`) };
}
const problems = (json: unknown) => {
  const r = parseCanvasJson(JSON.stringify(json));
  return r.ok ? [] : r.problems;
};

const MANIFEST = {
  zeta: { kept: true },
  order: ['phone', 'desk'],
  boards: {
    desk: { title: 'Desktop', h: 1024, w: 1440, y: 0, x: 500, locked: true },
    phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' },
  },
  dsOverrides: { '--ds-color-accent': '#c00' },
  faces: { lora: { family: 'Lora', src: 'assets/lora.woff2' } },
  designSystems: [{ id: 'x' }],
  title: 'Landing',
  v: 1,
  alpha: 1,
};

describe('the canvas paths', () => {
  it('names the manifest and one file per board, and reads a board id back only from a board path with a valid id', () => {
    expect(CANVAS_PATH).toBe('project/canvas.json');
    expect(boardPath('hero')).toBe('project/boards/hero.html');
    expect(boardIdOf('project/boards/hero.html')).toBe('hero');
    expect(boardIdOf('project/boards/a b.html')).toBeNull();
    expect(boardIdOf('project/slides/hero.html')).toBeNull();
    expect(boardIdOf(CANVAS_PATH)).toBeNull();
  });

  it('states E0’s model cap: 200 boards, a side of at most 16,384 px and an area of at most 2^26 px', () => {
    expect(CANVAS_LIMITS).toMatchObject({ boards: 200, side: 16_384, area: 67_108_864 });
  });
});

describe('canvas.json', () => {
  it('writes its keys in one order, the boards in manifest order with their frame first, every unknown key kept, and reaches a fixed point', () => {
    const { canvas, messages } = parse(MANIFEST);
    expect(messages).toEqual([]);
    const text = serializeCanvasJson(canvas);
    const out = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['v', 'title', 'boards', 'order', 'faces', 'designSystems', 'dsOverrides', 'alpha', 'zeta']);
    expect(Object.keys(out.boards as object)).toEqual(['phone', 'desk']);
    expect(Object.keys((out.boards as Record<string, object>).desk!)).toEqual(['x', 'y', 'w', 'h', 'title', 'locked']);
    expect(out.zeta).toEqual({ kept: true });
    expect(serializeCanvasJson(parse(text).canvas)).toBe(text);
  });

  it('gives equal meaning equal bytes whatever the input’s key order', () => {
    const a = parse({ boards: { b: { h: 2, w: 1, y: 0, x: 0 }, a: { x: 0, y: 0, w: 1, h: 2 } }, order: ['a', 'b'], faces: { b: { src: 'assets/b.woff2', family: 'B' }, a: { family: 'A', src: 'assets/a.woff2' } } });
    const b = parse({ order: ['a', 'b'], faces: { a: { src: 'assets/a.woff2', family: 'A' }, b: { family: 'B', src: 'assets/b.woff2' } }, boards: { a: { h: 2, w: 1, x: 0, y: 0 }, b: { x: 0, y: 0, w: 1, h: 2 } } });
    expect(serializeCanvasJson(a.canvas)).toBe(serializeCanvasJson(b.canvas));
  });

  it('keeps a key named __proto__ as an own key, at the top and in a board', () => {
    const { canvas } = parse('{"boards": {"a": {"x": 0, "y": 0, "w": 1, "h": 1, "__proto__": {"p": 1}}}, "order": ["a"], "__proto__": {"q": 2}}');
    const text = serializeCanvasJson(canvas);
    expect(text).toContain('"__proto__": {\n    "q": 2');
    expect(text).toContain('"__proto__": {\n        "p": 1');
    expect(serializeCanvasJson(parse(text).canvas)).toBe(text);
  });

  it('reads an absent boards and order as empty', () => {
    expect(parse({ v: 1 }).canvas).toMatchObject({ boards: {}, order: [] });
  });

  it('refuses text that is not a manifest: not JSON, not an object, boards or order of the wrong shape, a deck’s outline', () => {
    expect(parseCanvasJson('{')).toMatchObject({ ok: false, problems: [expect.stringMatching(/^project\/canvas\.json is not JSON/)] });
    expect(problems([])).toEqual(['project/canvas.json is not a JSON object']);
    expect(problems({ boards: [] })).toEqual(['boards is not an object of board id → {x, y, w, h, title?}']);
    expect(problems({ order: 'a' })).toEqual(['order is not a list of board ids']);
    expect(problems({ boards: { 'a b': { x: 0, y: 0, w: 1, h: 1 } } })).toEqual(['board id "a b" is not [A-Za-z0-9_-]{1,64}']);
    expect(problems({ boards: { a: 3 } })).toEqual(['board a: an entry is an object {x, y, w, h, title?}']);
    expect(problems({ sections: {} })).toEqual(['sections is a deck’s outline; a design has none']);
  });

  it('refuses a malformed or out-of-limit frame by board, never clamping it', () => {
    expect(problems({ boards: { a: { x: '1', y: 0, w: 1, h: 1 } } })).toEqual(['board a: x is not a finite number']);
    expect(problems({ boards: { a: { x: 0, y: null, w: 1, h: 1 } } })).toEqual(['board a: y is not a finite number']);
    expect(problems({ boards: { a: { x: 0, y: 0, w: 0, h: 1 } } })).toEqual(['board a: w is 0 (a side is more than 0 px)']);
    expect(problems({ boards: { a: { x: 0, y: 0, w: 390, h: -5 } } })).toEqual(['board a: h is -5 (a side is more than 0 px)']);
    expect(problems({ boards: { a: { x: 0, y: 0, w: 16_385, h: 10 } } })).toEqual(['board a: w is 16385 px (over 16384 px a side)']);
    expect(problems({ boards: { a: { x: 0, y: 0, w: 16_384, h: 8_192 } } })).toEqual(['board a: 16384×8192 is 134217728 px (over 67108864 px)']);
    expect(problems({ boards: { a: { x: 0, y: 0, w: 1, h: 1, title: 7 } } })).toEqual(['board a: title is not a string']);
    // the extremes the cap admits
    expect(problems({ boards: { a: { x: -1e6, y: 0.5, w: 16_384, h: 4_096 }, b: { x: 0, y: 0, w: 8_192, h: 8_192 }, c: { x: 0, y: 0, w: 1080, h: 16_384 } } })).toEqual([]);
  });

  it('refuses more than 200 boards', () => {
    const boards = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`b${i}`, { x: i, y: 0, w: 1, h: 1 }]));
    expect(problems({ boards })).toEqual(['project/canvas.json names 201 boards (over 200)']);
  });

  it('keeps an entry whose frame is partial (the publish completes it with its warned defaults)', () => {
    expect(parse({ boards: { a: { title: 'Only a title' }, b: { w: 390, h: 844 } } }).canvas.boards).toEqual({ a: { title: 'Only a title' }, b: { w: 390, h: 844 } });
  });

  it('drops, with a warning, an order entry that is not a board id or is listed twice, and checks faces and overrides as a deck does', () => {
    const { canvas, messages } = parse({ order: ['a', 'a', 'b c', 7, 'b'], faces: { url: { family: 'Url', href: 'https://example.com/font.css' } }, dsOverrides: { '--ds-page-width': '1in', '--ds-color-bg': '#fff' }, title: 3 });
    expect(canvas.order).toEqual(['a', 'b']);
    expect(canvas.faces).toEqual({});
    expect(canvas.dsOverrides).toEqual({ '--ds-color-bg': '#fff' });
    expect(canvas.title).toBeUndefined();
    expect(messages).toEqual([
      'warning order: board a is listed twice; the second dropped',
      'warning order: "b c" is not a board id; dropped',
      'warning order: 7 is not a board id; dropped',
      'warning title: title is not a string; dropped',
      expect.stringMatching(/^warning faces\.url: a face takes either href/),
      expect.stringMatching(/^warning dsOverrides\.--ds-page-width: /),
    ]);
  });
});

describe('frameProblems (the one frame check publish, the writers and the repair share)', () => {
  it('passes a whole valid frame and names each broken key', () => {
    expect(frameProblems('a', { x: 0, y: 0, w: 390, h: 844 })).toEqual([]);
    expect(frameProblems('a', { x: Number.NaN, y: Infinity, w: 1, h: 1 })).toEqual(['board a: x is not a finite number', 'board a: y is not a finite number']);
    expect(frameProblems('a', { w: 16_384, h: 4_097 })).toEqual(['board a: 16384×4097 is 67125248 px (over 67108864 px)']);
  });
});
