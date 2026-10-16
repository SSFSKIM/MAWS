// P3-E2 M1 spike: the renderer's binding grade, held by both candidates over the same closed inputs.
import { describe, expect, it } from 'vitest';
import { d3Kit } from '../src/kit-d3';
import { houseKit } from '../src/kit-house';
import { parseCsv } from '../src/model';
import { makeRenderer } from '../src/render';
import { themeFrom } from '../src/svg';
import { textWidth } from '../src/text';
import { CASES, grade, texts, theme } from './support';

const byId = (id: string) => CASES.find((c) => c.id === id)!;
const tips = (svg: string) => [...svg.matchAll(/data-tip="([^"]*)"/g)].map((m) => m[1]);

describe.each([d3Kit, houseKit])('candidate $name', (kit) => {
  const render = makeRenderer(kit);
  const draw = (id: string) => {
    const c = byId(id);
    return render(c.spec, c.table, theme, c.datasetId);
  };

  it('renders every case as well-formed SVG inside the grade: no script, event attribute, href, id or reference', () => {
    for (const c of CASES) {
      const { svg } = render(c.spec, c.table, theme, c.datasetId);
      const g = grade(svg);
      expect(g.problems, c.id).toEqual([]);
      expect(svg, c.id).not.toMatch(/<script|url\(/i); // attributes by name: `grade` parses them
    }
  });

  it('writes byte-equal output for equal inputs, whatever the time zone', () => {
    const before = process.env.TZ;
    try {
      const first = CASES.map((c) => render(c.spec, c.table, theme, c.datasetId).svg);
      process.env.TZ = 'Asia/Seoul';
      const seoul = CASES.map((c) => render(c.spec, c.table, theme, c.datasetId).svg);
      process.env.TZ = 'America/Los_Angeles';
      const la = CASES.map((c) => render(c.spec, c.table, theme, c.datasetId).svg);
      expect(seoul).toEqual(first);
      expect(la).toEqual(first);
    } finally {
      process.env.TZ = before;
    }
  });

  it('names every figure and describes where its data is', () => {
    for (const c of CASES.filter((item) => item.sheet)) {
      const { svg } = render(c.spec, c.table, theme, c.datasetId);
      const title = (c.spec as { title: string }).title;
      expect(svg).toContain(`role="img" aria-label="${title}"`);
      expect(svg).toMatch(new RegExp(`<title>${title.replace(/[()]/g, '\\$&')}</title><desc>[^<]*source table[^<]*</desc>`));
    }
  });

  it('draws all six view kinds over the real datasets', () => {
    const kinds = new Set(CASES.filter((c) => c.sheet).map((c) => (c.spec as { view: string }).view));
    expect([...kinds].sort()).toEqual(['area', 'bar', 'line', 'pie', 'scatter', 'table']);
    for (const c of CASES.filter((item) => item.sheet)) expect(draw(c.id).svg, c.id).not.toContain('cannot be drawn');
  });

  it('sorts after filtering and labels each bar with its value at the tip (2024 GDP growth, descending)', () => {
    const list = tips(draw('bar-gdp-2024').svg);
    expect(list.map((t) => t.split(' · ')[0])).toEqual(['미국', '캐나다', '대한민국', '프랑스', '영국', '이탈리아', '일본', '독일']);
    expect(list[0]).toBe('미국 · growth_pct: 2.79');
    expect(list[7]).toBe('독일 · growth_pct: \u22120.5');
    const g = grade(draw('bar-gdp-2024').svg);
    expect(g.texts).toContain('\u22120.24');
  });

  it('aggregates each group to the mean the data gives (penguin mass by species and sex)', () => {
    const table = parseCsv(texts.penguins);
    const at = (name: string) => table.columns.findIndex((c) => c.name === name);
    const sums = new Map<string, [number, number]>();
    for (const row of table.rows) {
      if (row[at('sex')] === null || row[at('body_mass_g')] === null) continue;
      const key = `${row[at('species_ko')]} · ${row[at('sex')]}`;
      const [s, n] = sums.get(key) ?? [0, 0];
      sums.set(key, [s + (row[at('body_mass_g')] as number), n + 1]);
    }
    const expected = [...sums].map(([key, [s, n]]) => `${key.split(' · ')[0]} · ${key.split(' · ')[1]} · body_mass_g: ${(Math.round((s / n) * 100) / 100).toString()}`);
    const drawn = tips(draw('bar-penguins-mass').svg);
    expect(drawn.sort()).toEqual(expected.sort());
    expect(drawn).toHaveLength(6);
  });

  it('counts rows for pie slices and keeps series identity from the unfiltered snapshot', () => {
    const pie = tips(draw('pie-penguins-island').svg);
    expect(pie).toEqual(['토르게르센섬: 52 (15.1%)', '비스코섬: 168 (48.8%)', '드림섬: 124 (36%)']);
    // Filtering to three economies keeps each one's style: its index in the whole snapshot (CAN, DEU, FRA, GBR, ITA, JPN, KOR, USA).
    const line = draw('line-gdp-three').svg;
    expect(line).toContain('stroke-dasharray');
    expect(grade(line).texts).toEqual(expect.arrayContaining(['일본', '대한민국', '미국']));
  });

  it('breaks a line at a missing value and counts what it did not draw, never drawing zero', () => {
    const table = { columns: [{ name: 'x', type: 'number' as const }, { name: 'y', type: 'number' as const }], rows: [[1, 2], [2, 3], [3, null], [4, 5], [5, 4]] };
    const { svg, warnings } = render({ view: 'line', x: 'x', y: 'y' }, table, theme, 't');
    const d = /<path d="(M[^"]*)" fill="none" stroke=/.exec(svg)![1];
    expect(d.match(/M/g)).toHaveLength(2);
    expect(warnings).toContain('1 row has no y; not drawn');
    expect(draw('edge-null-gaps').warnings).toContain('3 rows have no anomaly_c; not drawn');
  });

  it('draws the named error and empty states in place, keeping the caption', () => {
    expect(draw('edge-missing-column').svg).toContain('dataset &quot;gdp&quot; has no column &quot;inflation&quot;');
    expect(draw('edge-no-dataset').svg).toContain('no dataset &quot;sales&quot;');
    expect(draw('edge-no-dataset').svg).toContain('aria-label="Monthly sales"');
    expect(draw('edge-unknown-view').svg).toContain('unknown view &quot;sankey&quot;');
    expect(draw('edge-unknown-view').svg).toContain('aria-label="Flows"');
    for (const id of ['edge-empty-bar', 'edge-empty-line']) expect(draw(id).svg).toContain('no rows to draw');
    expect(draw('edge-empty-table').svg).toContain('no rows to draw');
  });

  it('escapes hostile labels and drops unknown spec keys with a warning', () => {
    const { svg, warnings } = draw('edge-hostile');
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;/text&gt;&lt;script&gt;');
    expect(warnings).toEqual(expect.arrayContaining(['unknown key "onclick" ignored', 'unknown key "href" ignored']));
    expect(grade(svg).problems).toEqual([]);
  });

  it('refuses a hostile theme value and keeps the house value', () => {
    const hostile = themeFrom({ '--ds-color-text': 'red" onload="alert(1)', '--ds-font-body': 'x;}</style><script>', '--ds-color-border': 'url(https://e.example/x)' });
    expect(hostile.warnings).toHaveLength(3);
    const c = byId('bar-gdp-2024');
    expect(grade(render(c.spec, c.table, hostile.theme, c.datasetId).svg).problems).toEqual([]);
  });

  it('draws extreme magnitudes as finite coordinates', () => {
    const { svg } = draw('edge-extreme');
    expect(svg).not.toMatch(/NaN|Infinity/);
    for (const c of CASES) expect(render(c.spec, c.table, theme, c.datasetId).svg, c.id).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('keeps every text inside the frame by its estimated width (Korean labels wrap, nothing clipped)', () => {
    for (const c of CASES) {
      const { svg } = render(c.spec, c.table, theme, c.datasetId);
      const width = Number(/width="(\d+)"/.exec(svg)![1]);
      for (const m of svg.matchAll(/<text x="([\d.-]+)" y="[\d.-]+"(?: text-anchor="(\w+)")?([^>]*)>(.*?)<\/text>/g)) {
        const size = Number(/font-size="([\d.]+)"/.exec(m[3])?.[1] ?? theme.caption);
        const lines = m[4].includes('<tspan') ? [...m[4].matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g)].map((t) => t[1]) : [m[4]];
        for (const line of lines) {
          const w = textWidth(line.replace(/&[a-z#0-9]+;/g, 'x'), size);
          const x = Number(m[1]);
          const [lo, hi] = m[2] === 'end' ? [x - w, x] : m[2] === 'middle' ? [x - w / 2, x + w / 2] : [x, x + w];
          expect(lo, `${c.id}: ${line}`).toBeGreaterThanOrEqual(-0.5);
          expect(hi, `${c.id}: ${line}`).toBeLessThanOrEqual(width + 0.5);
        }
      }
    }
    expect(grade(draw('edge-long-korean').svg).texts.join(' ')).toContain('서울특별시');
  });

  it('renders the synthetic 10,000-point inputs with bounded hover targets', () => {
    for (const id of ['stress-line-10k', 'stress-scatter-10k']) {
      const { svg, warnings } = draw(id);
      expect(tips(svg)).toHaveLength(1000);
      expect(warnings.some((w) => w.startsWith('10000 marks'))).toBe(true);
    }
  });
});

describe('the grade check', () => {
  it('catches a script, an event attribute, a link, an id, a reference and malformed XML', () => {
    const svg = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${body}</svg>`;
    expect(grade(svg('<script>alert(1)</script>')).problems).toContain('element <script>');
    expect(grade(svg('<rect onclick="x()"/>')).problems).toContain('attribute onclick on <rect>');
    expect(grade(svg('<a href="https://e.example/"><text>x</text></a>')).problems).toEqual(expect.arrayContaining(['element <a>', 'attribute href on <a>']));
    expect(grade(svg('<path d="M0,0" fill="url(#g)"/>')).problems).toContain('reference in fill="url(#g)"');
    expect(grade(svg('<g>', ' id="a"')).problems.length).toBeGreaterThan(0);
  });
});

describe('the two candidates', () => {
  it('agree on the drawn figure for every real view: the same texts, and the same coordinates within a pixel where the paths share a structure', () => {
    const a = makeRenderer(d3Kit);
    const b = makeRenderer(houseKit);
    const numbers = (svg: string) => [...svg.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const compared: string[] = [];
    for (const c of CASES.filter((item) => item.sheet)) {
      const left = a(c.spec, c.table, theme, c.datasetId).svg;
      const right = b(c.spec, c.table, theme, c.datasetId).svg;
      expect(grade(left).texts, c.id).toEqual(grade(right).texts);
      const [x, y] = [numbers(left), numbers(right)];
      if (['pie', 'area'].includes((c.spec as { view: string }).view)) continue;
      expect(x.length, c.id).toBe(y.length);
      compared.push(c.id);
      expect(Math.max(...x.map((v, i) => Math.abs(v - y[i]))), c.id).toBeLessThanOrEqual(1);
    }
    // d3 writes a pie's wedge from the rim and an area's baseline under every point; the e2e compares those by pixels.
    expect(compared).toHaveLength(CASES.filter((item) => item.sheet).length - 2);
  });
});
