// P3-E1 M6 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M6, acceptance 7): the scale gate's design, E0's
// bench mix (`spikes/p3-design/findings.txt` (b); its throwaway fixture.ts, rebuilt here as design files rather than a
// stand-in deck): six 390×844 phones, five 834×1194 tablets, five 1440×1024 desktops, four 1920×1080 slides, two
// 1080×8192 posters, one 4096² board and one 4096×8192 board. Each board is a header, a lede and a wrapping grid of
// cards scaled to its area (flow layout, so no host passes C's 24 pinned children; at most 55 cards, about 180 elements
// on the large boards, under C's 200 per board). Every element carries an id, so the scale gate's agent can restyle one
// card (`<board>`'s `c0`) and the gate can count what each canvas drew. No test framework here, and no import: the e2e
// project compiles this file alone (its paths are canvas.ts's CANVAS_PATH and boardPath, which bench.test.ts checks).

export const BENCH_SIZES = {
  phone: [390, 844],
  tablet: [834, 1194],
  desktop: [1440, 1024],
  slide: [1920, 1080],
  poster: [1080, 8192],
  square: [4096, 4096],
  tall: [4096, 8192],
} as const satisfies Record<string, readonly [number, number]>;
export type BenchSize = keyof typeof BENCH_SIZES;

/** E0's mix, in order: 24 boards, one of them 4,096×8,192. */
export const BENCH_MIX: readonly BenchSize[] = [
  ...Array<BenchSize>(6).fill('phone'),
  ...Array<BenchSize>(5).fill('tablet'),
  ...Array<BenchSize>(5).fill('desktop'),
  ...Array<BenchSize>(4).fill('slide'),
  'poster',
  'poster',
  'square',
  'tall',
];

export interface BenchBoard {
  id: string;
  size: BenchSize;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** How many elements the board's file holds (its header, lede, grid, cards and their contents). */
  elements: number;
}

const WORDS = 'pipeline revenue onboarding retention latency quarter forecast margin cohort launch hiring roadmap 매출 현황 지표 고객'.split(' ');
const words = (i: number, n: number) => Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]).join(' ');
const ICONS = ['Star', 'Check', 'Chart', 'Lightning'];
const MAX_CARDS = 55;
/** The card the scale gate's agent restyles on a board (its background between these two). */
export const BENCH_CARD = 'c0';
export const BENCH_CARD_FILLS = ['#ffffff', '#fff4d6'] as const;

/** A board's file and its element count: a header, a lede and a grid of cards sized to the board. */
export function benchBoardHtml(id: string, w: number, h: number, seed: number, cardFill: string = BENCH_CARD_FILLS[0]): { html: string; elements: number } {
  const pad = Math.min(96, Math.max(24, Math.round(Math.min(w, h) / 20)));
  const gap = 16;
  const title = Math.min(400, Math.max(28, Math.round(w / 18)));
  const cw = Math.min(320, Math.max(150, Math.floor((w - 2 * pad - gap) / 2)));
  const cols = Math.max(1, Math.floor((w - 2 * pad + gap) / (cw + gap)));
  const header = title * 1.2 + 40 + gap;
  const cards = Math.min(MAX_CARDS, cols * Math.max(1, Math.floor((h - 2 * pad - header + gap) / (140 + gap))));
  const rows = Math.ceil(cards / cols);
  const ch = Math.max(120, Math.floor((h - 2 * pad - header - (rows - 1) * gap) / rows));
  let elements = 3; // the header, the lede, the grid
  const grid = Array.from({ length: cards }, (_, k) => {
    const icon = k % 4 === 0 ? `<x-icon id="c${k}i" name="${ICONS[(seed + k) % ICONS.length]}" style="width:28px; height:28px; color:#2b6cb0"></x-icon>` : '';
    elements += k % 4 === 0 ? 4 : 3;
    const fill = k === 0 ? cardFill : BENCH_CARD_FILLS[0];
    return `<div id="c${k}" style="width:${cw}px; height:${ch}px; background:${fill}; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.12); padding:16px; gap:8px">${icon}<h3 id="c${k}h" style="font-size:20px; font-weight:600">${words(seed + k, 2)}</h3><p id="c${k}p" style="font-size:14px; line-height:1.5; color:#4a5560">${words(seed + k + 1, 8)}</p></div>`;
  }).join('');
  const html = `<section id="${id}" style="background:#f4f5f2; padding:${pad}px; gap:${gap}px">
<h1 id="head" style="font-size:${title}px; font-weight:700; color:#1a1a1a">${words(seed, 3)}</h1>
<p id="lede" style="font-size:${Math.max(14, Math.round(title / 2.5))}px; color:#5a6570">${words(seed + 2, 10)}</p>
<div id="grid" style="display:flex; flex-wrap:wrap; gap:${gap}px">${grid}</div>
</section>`;
  return { html, elements };
}

/** The 24 boards in rows left to right with 200 px gaps, a row wrapping past 12,000 px (E0's world). */
export function benchBoards(): BenchBoard[] {
  const out: BenchBoard[] = [];
  let [x, y, rowH] = [0, 0, 0];
  const counts = new Map<BenchSize, number>();
  BENCH_MIX.forEach((size, i) => {
    const [w, h] = BENCH_SIZES[size];
    if (x > 0 && x + w > 12_000) [x, y, rowH] = [0, y + rowH + 200, 0];
    const n = (counts.get(size) ?? 0) + 1;
    counts.set(size, n);
    const id = `b${String(i + 1).padStart(2, '0')}`;
    out.push({ id, size, title: `${size[0]!.toUpperCase()}${size.slice(1)} ${n}`, x, y, w, h, elements: benchBoardHtml(id, w, h, i).elements });
    x += w + 200;
    rowH = Math.max(rowH, h);
  });
  return out;
}

/** The design's files: `project/canvas.json` and one `project/boards/<id>.html` per board. */
export function benchDesignFiles(title = 'Scale 24'): Record<string, string> {
  const boards = benchBoards();
  const files: Record<string, string> = {
    'project/canvas.json': JSON.stringify({ v: 1, title, boards: Object.fromEntries(boards.map((b) => [b.id, { x: b.x, y: b.y, w: b.w, h: b.h, title: b.title }])), order: boards.map((b) => b.id) }),
  };
  boards.forEach((b, i) => (files[`project/boards/${b.id}.html`] = benchBoardHtml(b.id, b.w, b.h, i).html));
  return files;
}
