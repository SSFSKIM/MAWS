// The renderer's binding grade (P3-E2 M3; parent §2 "Views"): every view kind in Node, byte-equal for equal inputs in
// any time zone, nothing executable or referencing in the output (hostile labels, specs and themes included), named
// figures, and the data semantics' actual values over real data (M1's vendored World Bank and penguin tables, parsed by
// the host's own parser).
import { describe, expect, it, vi } from 'vitest';
import { HOUSE_TOKENS } from '../../document/export/design-system';
import { parseDataset, DatasetError } from '../parse';
import { GDP_CSV, PENGUINS_CSV } from '../fixtures/datasets';
import { renderFailure, renderView, themeFrom, TABLE_VIEW_MAX_ROWS, viewPreview, viewRows, type Rendered, type ViewTable } from './index';
import { textWidth } from './text';

const table = (csv: string): ViewTable => {
  const parsed = parseDataset(new TextEncoder().encode(csv), 'csv');
  if (parsed instanceof DatasetError) throw new Error(parsed.reason);
  return parsed;
};
const gdp = table(GDP_CSV);
const penguins = table(PENGUINS_CSV);
const theme = themeFrom(HOUSE_TOKENS.properties).theme;

it('does not borrow an accent when the governing system has not authorized it for figures', () => {
  const props = { '--ds-color-bg-raised': '#ffffff', '--ds-color-text': '#405569', '--ds-color-accent': '#bb22cc' };
  const draw = (values: Record<string, string>) => renderView({ view: 'bar', x: 'k', y: 'v' }, table('k,v\nNorth,12'), themeFrom(values).theme, 'sales').svg!;
  expect(draw(props)).not.toContain('#bb22cc');
  expect(draw(props)).toMatch(/<path [^>]*fill="#405569"[^>]*data-tip=/);
  expect(draw({ ...props, '--ds-color-figure': '#2864bb' })).toMatch(/<path [^>]*fill="#2864bb"[^>]*data-tip=/);
});

it('draws repeated bars in the governing accent while keeping labels in text ink', () => {
  const data = table('k,v\nNorth,12\nNorth,7\nSouth,9');
  const render = (accent: string) => renderView({ view: 'bar', x: 'k', y: 'v' }, data, themeFrom({ ...HOUSE_TOKENS.properties, '--ds-color-figure': accent }).theme, 'sales').svg!;
  const first = render('#2864bb');
  const marks = [...first.matchAll(/<path [^>]*data-tip="[^"]*"[^>]*>/g)].map(match => match[0]);
  expect(marks).toHaveLength(3);
  expect(marks.every(mark => mark.includes('fill="#2864bb"'))).toBe(true);
  expect(first).toContain(`fill="${theme.ink}"`);
  const next = render('#8952a4');
  expect(next).not.toContain('#2864bb');
  expect(next).toContain('#8952a4');
});


const LONG: ViewTable = {
  columns: [{ name: '지역 이름이 아주 긴 행정 구역의 공식 명칭', type: 'string' }, { name: '값', type: 'number' }],
  rows: [['서울특별시 종로구 세종대로 이백구 정부서울청사 별관', 12], ['부산광역시 해운대구', 7], ['제주특별자치도 서귀포시 대정읍 마라도 등대 앞 선착장', 3]],
};
// The one synthetic input: a seeded 10,000-point walk (an LCG), never real data.
function walk(n = 10_000): ViewTable {
  let seed = 20261016;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  let level = 0;
  const rows = Array.from({ length: n }, (_, i) => {
    level += next() - 0.5;
    return [i, Math.round(level * 1000) / 1000, next() * 100, ['a', 'b', 'c'][i % 3]];
  });
  return { columns: [{ name: 'step', type: 'number' }, { name: 'level', type: 'number' }, { name: 'noise', type: 'number' }, { name: 'group', type: 'string' }], rows };
}
// Synthetic series for the small multiples: `n` series S0…, `per` points each, series i's j-th point at (j, (i + 1)(j + 1)).
function manySeries(n: number, per = 3, name = (i: number) => `S${i}`): ViewTable {
  const rows = Array.from({ length: n * per }, (_, k) => {
    const [i, j] = [Math.floor(k / per), k % per];
    return [j, (i + 1) * (j + 1), name(i)];
  });
  return { columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 's', type: 'string' }], rows };
}
const longSeries = () => manySeries(8, 3, (i) => `제주특별자치도 서귀포시 대정읍 마라도 등대 앞 선착장 ${i + 1}번 관측소`);
const HOSTILE: ViewTable = {
  columns: [{ name: 'name', type: 'string' }, { name: 'v', type: 'number' }],
  rows: [['</text><script>alert(1)</script>', 1], ['" onload="alert(2)', 2], ['<a href="https://evil.example/">x</a>', 3], ['&amp; ]]> <!-- \u0000\u0007', 4]],
};
const EXTREME: ViewTable = { columns: [{ name: 'k', type: 'string' }, { name: 'v', type: 'number' }], rows: [['max', 1.7976931348623157e308], ['tiny', 5e-324], ['neg', -1e300], ['zero', 0]] };

interface Case {
  id: string;
  dataset: string;
  table: ViewTable | null;
  spec: unknown;
}
const CASES: Case[] = [
  { id: 'bar-gdp-2024', dataset: 'gdp', table: gdp, spec: { view: 'bar', x: 'country_ko', y: 'growth_pct', filter: [{ column: 'year', op: 'eq', value: 2024 }], sort: { by: 'growth_pct', dir: 'desc' }, title: '2024년 실질 GDP 성장률 (%)' } },
  { id: 'line-gdp-three', dataset: 'gdp', table: gdp, spec: { view: 'line', x: 'year', y: 'growth_pct', series: 'country_ko', filter: [{ column: 'iso3', op: 'in', value: ['KOR', 'JPN', 'USA'] }], format: { year: 'text' }, title: '대한민국·일본·미국 GDP 성장률, 2019–2024 (%)' } },
  { id: 'area-gdp-kor', dataset: 'gdp', table: gdp, spec: { view: 'area', x: 'year', y: 'growth_pct', filter: [{ column: 'iso3', op: 'eq', value: 'KOR' }], format: { year: 'text' }, title: 'Korea, GDP growth (%)' } },
  { id: 'bar-penguins-mass', dataset: 'penguins', table: penguins, spec: { view: 'bar', x: 'species_ko', y: 'body_mass_g', series: 'sex', agg: 'mean', filter: [{ column: 'sex', op: 'in', value: ['female', 'male'] }], title: '종과 성별에 따른 평균 체중 (g)' } },
  { id: 'scatter-penguins', dataset: 'penguins', table: penguins, spec: { view: 'scatter', x: 'flipper_length_mm', y: 'body_mass_g', series: 'species_ko', title: 'Flipper length and body mass of 344 penguins' } },
  { id: 'pie-penguins-island', dataset: 'penguins', table: penguins, spec: { view: 'pie', x: 'island_ko', agg: 'count', title: '섬별 관측 개체 수' } },
  { id: 'table-gdp-2020', dataset: 'gdp', table: gdp, spec: { view: 'table', columns: ['country_ko', 'country', 'growth_pct'], filter: [{ column: 'year', op: 'eq', value: 2020 }], sort: { by: 'growth_pct', dir: 'asc' }, title: '2020년 성장률, 낮은 순' } },
  { id: 'edge-empty-bar', dataset: 'gdp', table: { columns: gdp.columns, rows: [] }, spec: { view: 'bar', x: 'country_ko', y: 'growth_pct' } },
  { id: 'edge-empty-table', dataset: 'gdp', table: { columns: gdp.columns, rows: [] }, spec: { view: 'table' } },
  { id: 'edge-one-line', dataset: 'gdp', table: { columns: gdp.columns, rows: gdp.rows.slice(0, 1) }, spec: { view: 'line', x: 'year', y: 'growth_pct' } },
  { id: 'edge-one-pie', dataset: 'gdp', table: { columns: gdp.columns, rows: gdp.rows.slice(0, 1) }, spec: { view: 'pie', x: 'country', y: 'growth_pct' } },
  { id: 'edge-negative-bar', dataset: 'gdp', table: gdp, spec: { view: 'bar', x: 'country_ko', y: 'growth_pct', filter: [{ column: 'year', op: 'eq', value: 2020 }] } },
  { id: 'edge-missing-column', dataset: 'gdp', table: gdp, spec: { view: 'bar', x: 'country', y: 'inflation' } },
  { id: 'edge-no-dataset', dataset: 'sales', table: null, spec: { view: 'bar', x: 'month', y: 'total', title: 'Monthly sales' } },
  { id: 'edge-unknown-view', dataset: 'gdp', table: gdp, spec: { view: 'sankey', title: 'Flows' } },
  { id: 'edge-hostile', dataset: 'gdp', table: HOSTILE, spec: { view: 'bar', x: 'name', y: 'v', title: '<script>alert("t")</script> javascript:alert(3)', onclick: 'alert(4)', href: 'https://evil.example/' } },
  { id: 'edge-extreme', dataset: 'x', table: EXTREME, spec: { view: 'bar', x: 'k', y: 'v' } },
  { id: 'edge-long-korean', dataset: 'regions', table: LONG, spec: { view: 'bar', x: LONG.columns[0].name, y: '값', title: '이름이 긴 행정 구역별 값의 비교 — 줄바꿈과 잘림 없이' } },
  { id: 'facet-line-gdp', dataset: 'gdp', table: gdp, spec: { view: 'line', x: 'year', y: 'growth_pct', series: 'country_ko', format: { year: 'text' }, title: '8개국 GDP 성장률, 2019–2024 (%)' } },
  { id: 'facet-bar-gdp', dataset: 'gdp', table: gdp, spec: { view: 'bar', x: 'year', y: 'growth_pct', series: 'country_ko', filter: [{ column: 'year', op: 'gt', value: 2021 }], format: { year: 'text' }, title: 'GDP growth by country, 2022–2024' } },
  { id: 'facet-long-korean', dataset: 'regions', table: longSeries(), spec: { view: 'scatter', x: 'x', y: 'y', series: 's', title: '긴 이름의 계열 여덟 개' } },
  { id: 'stress-line-10k', dataset: 'walk', table: walk(), spec: { view: 'line', x: 'step', y: 'level', title: 'Synthetic walk, 10,000 steps' } },
  { id: 'stress-scatter-10k', dataset: 'walk', table: walk(), spec: { view: 'scatter', x: 'step', y: 'noise', series: 'group', title: 'Synthetic noise in three groups' } },
];
const byId = (id: string) => CASES.find((c) => c.id === id)!;
// a case's output, both fields typed as text (a chart's `html`, a table's `svg`, is undefined at run time)
const draw = (id: string) => {
  const c = byId(id);
  return renderView(c.spec, c.table, theme, c.dataset) as unknown as { svg: string; html: string; warnings: string[] };
};
/** A view's one output, whichever it is. */
const out = (rendered: Rendered): string => rendered.svg ?? rendered.html!;
const tips = (svg: string) => [...svg.matchAll(/data-tip="([^"]*)"/g)].map((m) => m[1]);
/** A faceted figure's panels: each `<g role="group" aria-label>` (its series' label) and what it draws. */
const panels = (svg: string) => [...svg.matchAll(/<g role="group" aria-label="([^"]*)">(.*?)<\/g>/g)].map((m) => ({ label: m[1], body: m[2] }));
/** A legend entry's key mark, its numbers blanked: the form that tells its series apart. */
const formOf = (svg: string, label: string): string => {
  const legend = /<g>(.*?)<\/g>/.exec(svg)![1];
  const key = legend.slice(0, legend.lastIndexOf('<text', legend.indexOf(`>${label}</text>`)));
  return key.slice(key.lastIndexOf('<path d="M')).replace(/-?\d+(?:\.\d+)?/g, '#');
};
/** A panel's plot box, from its grid rules (`M x0,y H x1`). */
const boxOf = (body: string) => {
  const rules = [...body.matchAll(/<path d="M([\d.]+),([\d.]+)H([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
  return { x0: rules[0][0], x1: rules[0][2], top: Math.min(...rules.map((r) => r[1])), bottom: Math.max(...rules.map((r) => r[1])), rules: rules.map((r) => r[1]) };
};
/** The nearest-point layer's points and their tips. */
const layer = (svg: string) => {
  const m = /<g data-hover="nearest" data-xy="([^"]*)" data-tips="([^"]*)"\/>/.exec(svg)!;
  const tipList = m[2].split('&#10;');
  return m[1].split(' ').map((pair, i) => ({ x: Number(pair.split(',')[0]), y: Number(pair.split(',')[1]), tip: tipList[i] }));
};

// ── the grade: a strict reading of the output as XML, against a whitelist ──

const ELEMENTS = new Set(['svg', 'title', 'desc', 'g', 'path', 'rect', 'text', 'tspan']);
// A table view's HTML (parent Decision Log 24): table elements, and no attribute but the renderer's own classes.
const TABLE_ELEMENTS = new Set(['table', 'caption', 'thead', 'tbody', 'tr', 'th', 'td']);
const TABLE_CLASSES = new Set(['dash-table', 'dash-table-note', 'dash-num']);
const ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'width', 'height', 'role', 'aria-label', 'font-family', 'font-size', 'font-weight', 'fill', 'fill-opacity', 'style',
  'd', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linejoin', 'stroke-linecap', 'paint-order', 'transform', 'pointer-events',
  'x', 'y', 'dy', 'rx', 'text-anchor', 'data-tip', 'data-hover', 'data-xy', 'data-tips',
]);
const TEXT_ATTRIBUTES = new Set(['aria-label', 'data-tip', 'data-tips', 'font-family']);
const ENTITY = /&(?:amp|lt|gt|quot|#39|#10);/g;

/** Every grade violation: anything that is not the whitelist's elements and attributes, well formed; a reference. */
function grade(svg: string): { problems: string[]; texts: string[] } {
  const html = svg.startsWith('<table');
  const problems: string[] = [];
  const texts: string[] = [];
  const stack: string[] = [];
  const token = /<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z:-]+="[^"<>]*")*)\s*(\/?)>|([^<]+)/gy;
  let at = 0;
  for (let m = token.exec(svg); m !== null; m = token.exec(svg)) {
    at = token.lastIndex;
    const [, close, tag, attrs, selfClose, content] = m;
    if (content !== undefined) {
      if (content.replace(ENTITY, '').includes('&')) problems.push(`raw & in text: ${content}`);
      if (stack.length === 0) problems.push('text outside the root');
      if (content.trim()) texts.push(content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
      continue;
    }
    if (close) {
      if (stack.pop() !== tag) problems.push(`unbalanced </${tag}>`);
      continue;
    }
    if (!(html ? TABLE_ELEMENTS : ELEMENTS).has(tag)) problems.push(`element <${tag}>`);
    if (stack.length === 0 && tag !== (html ? 'table' : 'svg')) problems.push('not a root');
    for (const [, name, value] of attrs.matchAll(/\s+([a-zA-Z:-]+)="([^"]*)"/g)) {
      if (html) {
        if (name !== 'class' || !TABLE_CLASSES.has(value)) problems.push(`attribute ${name}="${value}" on <${tag}>`);
        continue;
      }
      if (!ATTRIBUTES.has(name)) problems.push(`attribute ${name} on <${tag}>`);
      if (value.replace(ENTITY, '').includes('&')) problems.push(`raw & in ${name}`);
      if (name === 'style' && value !== 'font-variant-numeric:tabular-nums') problems.push(`style "${value}"`);
      if (!TEXT_ATTRIBUTES.has(name) && name !== 'xmlns' && /url\(|javascript:|https?:|data:|#[a-z]/i.test(value.replace(/^#[0-9a-f]{6}$/i, ''))) problems.push(`reference in ${name}="${value}"`);
    }
    if (!selfClose) stack.push(tag);
  }
  if (at !== svg.length) problems.push(`unreadable from ${at}: ${svg.slice(at, at + 40)}`);
  if (stack.length > 0) problems.push(`unclosed <${stack.join('> <')}>`);
  if (!html && !svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')) problems.push('not an SVG root');
  return { problems, texts };
}

describe('the grade check', () => {
  it('catches a script, an event attribute, a link, an id, a reference and malformed XML', () => {
    const svg = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${body}</svg>`;
    expect(grade(svg('<path d="M0,0" fill="#1f1e1b"/>')).problems).toEqual([]);
    expect(grade(svg('<script>alert(1)</script>')).problems).toContain('element <script>');
    expect(grade(svg('<rect onclick="x()"/>')).problems).toContain('attribute onclick on <rect>');
    expect(grade(svg('<a href="https://e.example/"><text>x</text></a>')).problems).toEqual(expect.arrayContaining(['element <a>', 'attribute href on <a>']));
    expect(grade(svg('<path d="M0,0" fill="url(#g)"/>')).problems).toContain('reference in fill="url(#g)"');
    expect(grade(svg('<g>', ' id="a"')).problems.length).toBeGreaterThan(0);
    expect(grade(svg('<text>a & b</text>')).problems.length).toBeGreaterThan(0);
    expect(grade('<table class="dash-table"><tbody><tr><td class="dash-num">1</td></tr></tbody></table>').problems).toEqual([]);
    expect(grade('<table class="dash-table"><tr><td style="color:red">1</td></tr></table>').problems).toEqual(['attribute style="color:red" on <td>']);
    expect(grade('<table class="x"><tr><td><a>1</a></td></tr></table>').problems).toEqual(expect.arrayContaining(['attribute class="x" on <table>', 'element <a>']));
  });
});

describe('renderView', () => {
  it('renders every case, all six kinds included, in Node, inside the grade', () => {
    for (const c of CASES) {
      const rendered = renderView(c.spec, c.table, theme, c.dataset);
      expect(rendered.svg === undefined, c.id).not.toBe(rendered.html === undefined); // exactly one output
      expect(rendered.html === undefined, c.id).toBe((c.spec as { view?: string }).view !== 'table' || c.table === null);
      expect(grade(out(rendered)).problems, c.id).toEqual([]);
      expect(out(rendered), c.id).not.toMatch(/NaN|Infinity|undefined/);
    }
    const kinds = CASES.filter((c) => c.table && !c.id.startsWith('edge')).map((c) => (c.spec as { view: string }).view);
    expect([...new Set(kinds)].sort()).toEqual(['area', 'bar', 'line', 'pie', 'scatter', 'table']);
    for (const c of CASES.filter((c) => !c.id.startsWith('edge'))) expect(out(renderView(c.spec, c.table, theme, c.dataset)), c.id).not.toContain('cannot be drawn');
  });

  it('writes byte-equal output for equal inputs, whatever the time zone', () => {
    try {
      const first = CASES.map((c) => out(renderView(c.spec, c.table, theme, c.dataset)));
      expect(CASES.map((c) => out(renderView(c.spec, c.table, theme, c.dataset)))).toEqual(first);
      vi.stubEnv('TZ', 'Asia/Seoul');
      expect(new Date(0).getHours()).toBe(9); // the zone took
      expect(CASES.map((c) => out(renderView(c.spec, c.table, theme, c.dataset)))).toEqual(first);
      vi.stubEnv('TZ', 'America/Los_Angeles');
      expect(CASES.map((c) => out(renderView(c.spec, c.table, theme, c.dataset)))).toEqual(first);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('names every figure and says where its data is', () => {
    const { svg } = draw('bar-gdp-2024');
    expect(svg).toContain('role="img" aria-label="2024년 실질 GDP 성장률 (%)"');
    expect(svg).toMatch(/<title>2024년 실질 GDP 성장률 \(%\)<\/title><desc>Bar chart of growth_pct by country_ko, 8 values\. The values are in the source table under the figure\.<\/desc>/);
    expect(renderView({ view: 'line', x: 'year', y: 'growth_pct' }, gdp, theme, 'gdp').svg).toContain('aria-label="Line chart of gdp"');
  });

  it('filters, then sorts, and labels each bar with its value (2024 GDP growth, descending)', () => {
    const list = tips(draw('bar-gdp-2024').svg);
    expect(list.map((t) => t.split(' · ')[0])).toEqual(['미국', '캐나다', '대한민국', '프랑스', '영국', '이탈리아', '일본', '독일']);
    expect(list[0]).toBe('미국 · growth_pct: 2.79');
    expect(list[7]).toBe('독일 · growth_pct: −0.5');
    expect(grade(draw('bar-gdp-2024').svg).texts).toContain('−0.24');
  });

  it('aggregates each group to the mean the data gives (penguin mass by species and sex)', () => {
    const at = (name: string) => penguins.columns.findIndex((c) => c.name === name);
    const sums = new Map<string, [number, number]>();
    for (const row of penguins.rows) {
      if (row[at('sex')] === null || row[at('body_mass_g')] === null) continue;
      const key = `${row[at('species_ko')]} · ${row[at('sex')]}`;
      const [s, n] = sums.get(key) ?? [0, 0];
      sums.set(key, [s + (row[at('body_mass_g')] as number), n + 1]);
    }
    const expected = [...sums].map(([key, [s, n]]) => `${key} · body_mass_g: ${Math.round((s / n) * 100) / 100}`);
    const drawn = tips(draw('bar-penguins-mass').svg);
    expect(drawn.sort()).toEqual(expected.sort());
    expect(drawn).toHaveLength(6);
  });

  it('counts rows for pie slices', () => {
    expect(tips(draw('pie-penguins-island').svg)).toEqual(['토르게르센섬: 52 (15.1%)', '비스코섬: 168 (48.8%)', '드림섬: 124 (36%)']);
    const texts = grade(draw('pie-penguins-island').svg).texts;
    expect(texts.filter((t) => ['1', '2', '3'].includes(t))).toEqual(['1', '2', '3', '1', '2', '3']);
  });

  it('folds the smallest pie slices: the five largest keep their names in the view\'s order, ties by that order (E2 panel)', () => {
    const t: ViewTable = { columns: [{ name: 'k', type: 'string' }, { name: 'v', type: 'number' }], rows: [['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5], ['f', 100], ['g', 200]] };
    const { svg = '', warnings } = renderView({ view: 'pie', x: 'k', y: 'v' }, t, theme, 't');
    expect(tips(svg)).toEqual(['c: 3 (1%)', 'd: 4 (1.3%)', 'e: 5 (1.6%)', 'f: 100 (31.7%)', 'g: 200 (63.5%)', 'other (2): 3 (1%)']);
    expect(warnings).toContain('7 slices; the five largest are shown individually and the rest are drawn as one');
    // unsorted, and ties: equal sizes keep the earlier rows
    const tied: ViewTable = { columns: t.columns, rows: [['a', 5], ['b', 9], ['c', 5], ['d', 1], ['e', 5], ['f', 5], ['g', 5], ['h', 9]] };
    expect(tips(renderView({ view: 'pie', x: 'k', y: 'v' }, tied, theme, 't').svg!).map((tip) => tip.split(':')[0])).toEqual(['a', 'b', 'c', 'e', 'h', 'other (3)']);
    // six slices or fewer: every one named, in the view's order
    expect(tips(renderView({ view: 'pie', x: 'k', y: 'v' }, { columns: t.columns, rows: t.rows.slice(1) }, theme, 't').svg!).map((tip) => tip.split(':')[0])).toEqual(['b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('lays out the rows that repeat a category in one series side by side in its slot, each its own bar, label and tip (S-REPEATED-BARS)', () => {
    /** Each bar (a mark with a tip): its horizontal extent from its path's x coordinates. */
    const barsOf = (svg: string) =>
      [...svg.matchAll(/<path d="([^"]*)"[^>]*? data-tip="([^"]*)"/g)].map(([, d, tip]) => {
        const xs: number[] = [];
        for (const [, op, args] of d.matchAll(/([MVAHhZ])([^MVAHhZ]*)/g)) {
          const n = args.split(',').filter(Boolean).map(Number);
          if (op === 'M' || op === 'H') xs.push(n[0]);
          if (op === 'A') xs.push(n[5]);
          if (op === 'h') xs.push(xs[xs.length - 1] + n[0]);
        }
        return { tip, x0: Math.min(...xs), x1: Math.max(...xs) };
      });
    /** The texts centred on a point (the x labels and the value labels) by their words. */
    const centred = (svg: string) => new Map([...svg.matchAll(/<text x="([\d.-]+)" y="[\d.-]+" text-anchor="middle"[^>]*>([^<]*)<\/text>/g)].map((m) => [m[2], Number(m[1])]));
    const disjoint = (list: { x0: number; x1: number }[]) => list.every((a, i) => list.every((b, j) => i === j || a.x1 <= b.x0 || b.x1 <= a.x0));
    const columns: ViewTable['columns'] = [{ name: 'k', type: 'string' }, { name: 'v', type: 'number' }, { name: 's', type: 'string' }];
    const draw = (rows: (string | number | null)[][], series?: string) => renderView({ view: 'bar', x: 'k', y: 'v', ...(series ? { series } : {}) }, { columns, rows }, theme, 't');
    // A category's band, from the x labels' centres (the band is 0.8 of the step between them).
    const bandOf = (at: Map<string, number>, key: string) => {
      const step = Math.abs(at.get('B')! - at.get('A')!);
      return [at.get(key)! - 0.4 * step, at.get(key)! + 0.4 * step];
    };

    // two rows of one series at A: two bars side by side inside A's band, each with its own value label over it
    const one = draw([['A', 4, 's1'], ['A', 10, 's1'], ['B', 3, 's1']]);
    expect(one.warnings).toEqual([]); // no overlap to warn of
    const bars = barsOf(one.svg!);
    expect(bars.map((b) => b.tip)).toEqual(['A · v: 4', 'A · v: 10', 'B · v: 3']);
    const at = centred(one.svg!);
    const [a1, a2, b] = bars;
    expect(disjoint(bars)).toBe(true);
    expect(a1.x1).toBeLessThanOrEqual(a2.x0); // in the rows' order
    const [lo, hi] = bandOf(at, 'A');
    for (const bar of [a1, a2]) expect(bar.x0 >= lo && bar.x1 <= hi, bar.tip).toBe(true);
    expect((a1.x0 + a2.x1) / 2).toBeCloseTo(at.get('A')!, 1); // the repeats centred on their category
    expect(at.get('4')).toBeCloseTo((a1.x0 + a1.x1) / 2, 1);
    expect(at.get('10')).toBeCloseTo((a2.x0 + a2.x1) / 2, 1);
    // a category without a repeat is drawn as it was: one bar centred on its label
    expect((b.x0 + b.x1) / 2).toBeCloseTo(at.get('B')!, 1);
    expect(at.get('3')).toBeCloseTo((b.x0 + b.x1) / 2, 1);

    // series and repeats share the band: s1's two rows in s1's half, s2's one row in s2's, none overlapping
    const both = draw([['A', 4, 's1'], ['A', 6, 's1'], ['A', 10, 's2'], ['B', 3, 's1']], 's');
    expect(both.warnings).toEqual([]);
    const shared = barsOf(both.svg!);
    const sharedAt = centred(both.svg!);
    const inA = shared.filter((bar) => bar.tip.startsWith('A '));
    expect(inA.map((bar) => bar.tip)).toEqual(['A · s1 · v: 4', 'A · s1 · v: 6', 'A · s2 · v: 10']);
    expect(disjoint(inA)).toBe(true);
    const [sharedLo, sharedHi] = bandOf(sharedAt, 'A');
    const middle = sharedAt.get('A')!;
    for (const bar of inA) expect(bar.x0 >= sharedLo && bar.x1 <= sharedHi, bar.tip).toBe(true);
    expect(inA[0].x1 <= middle && inA[1].x1 <= middle && inA[2].x0 >= middle).toBe(true);
    for (const [bar, label] of [[inA[0], '4'], [inA[1], '6'], [inA[2], '10']] as const) expect(sharedAt.get(label), label).toBeCloseTo((bar.x0 + bar.x1) / 2, 1);

    // opposite signs at one category are two rows too: side by side, one above the zero line and one below
    const signs = barsOf(draw([['A', 4, 's1'], ['A', -3, 's1'], ['B', 1, 's1']]).svg!);
    expect(signs.map((bar) => bar.tip)).toEqual(['A · v: 4', 'A · v: −3', 'B · v: 1']);
    expect(disjoint(signs)).toBe(true);
    // a row with nothing to draw takes no slot (it is counted under the view): the one drawable row is centred alone
    const gap = draw([['A', null, 's1'], ['A', 3, 's1'], ['B', 1, 's1']]);
    const [lone] = barsOf(gap.svg!);
    expect((lone.x0 + lone.x1) / 2).toBeCloseTo(centred(gap.svg!).get('A')!, 1);
    expect(gap.warnings).toEqual(['1 row has no v; not drawn']);
    // no overlap warning is left for repeats anywhere
    const many = draw([['A', 1, 's1'], ['A', 2, 's1'], ['B', 1, 's1'], ['B', 2, 's1'], ['C', 3, 's1'], ['D', 4, 's1'], ['D', 5, 's1']]);
    expect(many.warnings).toEqual([]);
    expect(disjoint(barsOf(many.svg!))).toBe(true);
  });

  it('keeps series identity from the unfiltered snapshot: a filter never changes a surviving series\' form', () => {
    const spec = { view: 'scatter', x: 'flipper_length_mm', y: 'body_mass_g', series: 'species_ko' };
    const three = renderView(spec, penguins, theme, 'penguins').svg!;
    const two = renderView({ ...spec, filter: [{ column: 'species', op: 'in', value: ['Adelie', 'Gentoo'] }] }, penguins, theme, 'penguins').svg!;
    expect(panels(three)).toEqual([]); // three forms: one figure, a legend
    for (const name of ['아델리펭귄', '젠투펭귄']) expect(formOf(two, name), name).toBe(formOf(three, name));
    expect(formOf(two, '아델리펭귄')).not.toBe(formOf(two, '젠투펭귄'));
  });

  it('breaks a line at a missing value and counts what it did not draw, never drawing zero', () => {
    const t: ViewTable = { columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }], rows: [[1, 2], [2, 3], [3, null], [4, 5], [5, 4]] };
    const { svg = '', warnings } = renderView({ view: 'line', x: 'x', y: 'y' }, t, theme, 't');
    const d = /<path d="(M[^"]*)" fill="none" stroke=/.exec(svg)![1];
    expect(d.match(/M/g)).toHaveLength(2);
    expect(warnings).toContain('1 row has no y; not drawn');
    expect(tips(svg)).toEqual([]);
    expect(/data-xy="([^"]*)"/.exec(svg)![1].split(' ')).toHaveLength(4);
  });

  it('keeps every row without agg, and a date axis in UTC whatever the offsets the dates were written in', () => {
    const t: ViewTable = { columns: [{ name: 'at', type: 'date' }, { name: 'v', type: 'number' }], rows: [['2026-10-16T09:00:00+09:00', 1], ['2026-10-16T00:30:00.123456789Z', 2], ['2026-10-16', 3], ['2026-10-16', 4]] };
    const { svg = '' } = renderView({ view: 'scatter', x: 'at', y: 'v' }, t, theme, 't');
    const list = /data-tips="([^"]*)"/.exec(svg)![1].split('&#10;');
    expect(list).toEqual(['2026-10-16 00:00 UTC · v: 1', '2026-10-16 00:30:00.123 UTC · v: 2', '2026-10-16 · v: 3', '2026-10-16 · v: 4']);
  });

  it('keeps accepted sub-minute distinctions apart on the axis, in the tips, the table and the export preview (E2 panel)', () => {
    const t: ViewTable = { columns: [{ name: 'at', type: 'date' }, { name: 'v', type: 'number' }], rows: [['2026-10-16T00:00:01Z', 1], ['2026-10-16T00:00:02Z', 2], ['2026-10-16T00:00:02.500Z', 3], ['2026-10-16T00:01Z', 4]] };
    const { svg = '' } = renderView({ view: 'scatter', x: 'at', y: 'v' }, t, theme, 't');
    expect(layer(svg).map((p) => p.tip)).toEqual(['2026-10-16 00:00:01 UTC · v: 1', '2026-10-16 00:00:02 UTC · v: 2', '2026-10-16 00:00:02.500 UTC · v: 3', '2026-10-16 00:01 UTC · v: 4']);
    const seconds = renderView({ view: 'line', x: 'at', y: 'v' }, { columns: t.columns, rows: t.rows.slice(0, 2) }, theme, 't').svg!;
    const ticks = grade(seconds).texts.filter((text) => text.startsWith('10-16'));
    expect(ticks.length).toBeGreaterThan(1);
    expect(new Set(ticks).size).toBe(ticks.length);
    for (const tick of ticks) expect(tick).toMatch(/^10-16 00:00:0\d(?:\.\d{3})?$/);
    const cells = ['2026-10-16 00:00:01 UTC', '2026-10-16 00:00:02 UTC', '2026-10-16 00:00:02.500 UTC', '2026-10-16 00:01 UTC'];
    expect(renderView({ view: 'table' }, t, theme, 't').table!.rows.map((row) => row[0])).toEqual(cells);
    const preview = viewPreview({ view: 'line', x: 'at', y: 'v' }, t, 't');
    expect(preview.ok && preview.table.rows.map((row) => row[0])).toEqual(cells);
    // a calendar date stays a date; a date-time on the minute keeps its minutes
    expect(renderView({ view: 'table' }, { columns: t.columns, rows: [['0099-01-01', 1], ['2026-10-16T09:00+09:00', 2]] }, theme, 't').table!.rows.map((row) => row[0])).toEqual(['0099-01-01', '2026-10-16 00:00 UTC']);
  });

  it('draws the named error and empty states in place, keeping the caption', () => {
    expect(draw('edge-missing-column').svg).toContain('dataset &quot;gdp&quot; has no column &quot;inflation&quot;');
    expect(draw('edge-no-dataset').svg).toContain('no dataset &quot;sales&quot;');
    expect(draw('edge-no-dataset').svg).toContain('aria-label="Monthly sales"');
    expect(draw('edge-unknown-view').svg).toContain('unknown view &quot;sankey&quot;');
    expect(draw('edge-unknown-view').svg).toContain('aria-label="Flows"');
    expect(draw('edge-empty-bar').svg).toContain('no rows to draw');
    expect(draw('edge-empty-table').html).toContain('<caption class="dash-table-note">no rows to draw</caption>');
    const unreadable = renderFailure(byId('edge-no-dataset').spec, theme, 'sales', 'the file of "sales" could not be read');
    expect(unreadable.svg).toContain('the file of &quot;sales&quot; could not be read');
    expect(unreadable.svg).toContain('aria-label="Monthly sales"');
    expect(renderView('{"view":"bar"}', gdp, theme, 'gdp').svg).toContain('the view spec is not an object');
  });

  it('escapes hostile labels and drops unknown spec keys with a warning', () => {
    const { svg, warnings } = draw('edge-hostile');
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;/text&gt;&lt;script&gt;');
    expect(warnings).toEqual(expect.arrayContaining(['unknown key "onclick" ignored', 'unknown key "href" ignored']));
    const texts = grade(svg).texts.join(' ');
    expect(texts.includes('\u0000') || texts.includes('\u0007')).toBe(false);
  });

  it('refuses a hostile theme value and keeps the house value', () => {
    const hostile = themeFrom({ ...HOUSE_TOKENS.properties, '--ds-color-text': 'red" onload="alert(1)', '--ds-font-body': 'x;}</style><script>', '--ds-color-border': 'url(https://e.example/x)', '--ds-type-caption-size': '0px', '--ds-type-body-size': '16px' });
    expect(hostile.warnings).toEqual(['theme value --ds-color-text refused', 'theme value --ds-color-border refused', 'theme value --ds-font-body refused', 'theme value --ds-type-caption-size refused']);
    expect(hostile.theme).toEqual(theme);
    const c = byId('bar-gdp-2024');
    expect(grade(out(renderView(c.spec, c.table, hostile.theme, c.dataset))).problems).toEqual([]);
    // an absent or empty value is the house system's, without a warning (a page with no system in scope)
    expect(themeFrom({ '--ds-color-text': '' })).toEqual({ theme, warnings: [] });
  });

  it('draws extreme magnitudes as finite coordinates, counting what it cannot draw', () => {
    const { svg, warnings } = draw('edge-extreme');
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(warnings).toContain('1 value is too large to draw');
  });

  it('keeps every text inside the frame by its estimated width; long Korean category names wrap rather than drop', () => {
    for (const c of CASES) {
      const { svg = '' } = renderView(c.spec, c.table, theme, c.dataset);
      if (!svg) continue; // a table view is text the page lays out
      const width = Number(/width="(\d+)"/.exec(svg)![1]);
      for (const m of svg.matchAll(/<text(?: pointer-events="none")? x="([\d.-]+)" y="[\d.-]+"(?: text-anchor="(\w+)")?([^>]*)>(.*?)<\/text>/g)) {
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
    const texts = grade(draw('edge-long-korean').svg).texts.join(' ');
    for (const name of ['서울특별시', '부산광역시 해운대구', '제주특별자치도']) expect(texts).toContain(name);
  });

  it('carries a hover value for every drawable point, all 10,000 synthetic points included', () => {
    const layer = (svg: string) => {
      const m = /<g data-hover="nearest" data-xy="([^"]*)" data-tips="([^"]*)"\/>/.exec(svg)!;
      return { xy: m[1].split(' '), tips: m[2].split('&#10;') };
    };
    for (const id of ['stress-line-10k', 'stress-scatter-10k']) {
      const { xy, tips: list } = layer(draw(id).svg);
      expect(xy, id).toHaveLength(10_000);
      expect(new Set(list).size, id).toBe(10_000);
    }
    expect(layer(draw('stress-line-10k').svg).tips.at(-1)).toMatch(/^9999 · level: /);
    expect(layer(draw('scatter-penguins').svg).tips).toHaveLength(342);
  });

  it('draws bar hatching that cannot take the bar\'s pointer: the mark under it is the hit target (M1 review debt)', () => {
    // three species per island: solid, hollow, and hatched at 45° (the third series' treatment)
    const { svg = '' } = renderView({ view: 'bar', x: 'island_ko', series: 'species_ko', agg: 'count' }, penguins, theme, 'penguins');
    const paths = [...svg.matchAll(/<path [^>]*\/>/g)].map((m) => m[0]);
    const hatches = paths.filter((p) => p.includes('fill="none"') && /stroke-width="1"/.test(p) && /L/.test(/ d="([^"]*)"/.exec(p)![1]));
    expect(hatches.length).toBeGreaterThan(0);
    for (const h of hatches) expect(h).toContain('pointer-events="none"');
    // every bar carries its tip on the mark itself, filled (a hollow bar's fill is the ground, so its inside hits)
    for (const bar of paths.filter((p) => p.includes('data-tip'))) expect(bar).not.toContain('fill="none"');
  });

  it('tells series apart by more than colour: each grouped bar wears its series\' treatment', () => {
    const { svg } = draw('bar-penguins-mass');
    const bySeries = new Map<string, Set<string>>();
    for (const m of svg.matchAll(/<path d="[^"]*" fill="([^"]*)"(?: fill-opacity="[^"]*")?(?: stroke="([^"]*)" stroke-width="[^"]*")?(?: stroke-dasharray="([^"]*)")? data-tip="([^"]*)"\/>(<path [^>]*pointer-events="none"\/>)?/g)) {
      const series = m[4].split(' · ')[1];
      bySeries.set(series, (bySeries.get(series) ?? new Set()).add(`${m[1]}|${m[2]}|${m[3]}|${m[5] !== undefined}`));
    }
    expect([...bySeries.keys()].sort()).toEqual(['female', 'male']);
    expect([...bySeries.values()].map((t) => t.size)).toEqual([1, 1]);
    expect(new Set([...bySeries.values()].map((t) => [...t][0])).size).toBe(2);
  });

  it('draws a table view as native table HTML in the view\'s order, its numbers marked, nothing else', () => {
    const { html, warnings } = draw('table-gdp-2020');
    expect(html).toMatch(/^<table class="dash-table"><thead><tr><th>country_ko<\/th><th>country<\/th><th class="dash-num">growth_pct<\/th><\/tr><\/thead><tbody><tr><td>영국<\/td><td>United Kingdom<\/td><td class="dash-num">−10\.05<\/td><\/tr>/);
    expect(html).not.toContain('<caption'); // eight rows, all shown
    expect(warnings).toEqual([]);
    const hostile = renderView({ view: 'table' }, HOSTILE, theme, 'gdp').html!;
    expect(hostile).toContain('&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(grade(hostile).problems).toEqual([]);
  });

  it('bounds a table view: 25 rows without a limit, an explicit limit up to 100, the note counting the whole transformed view', () => {
    const rows = (rendered: Rendered) => (rendered.html!.match(/<tr>/g) ?? []).length - 1;
    const note = (rendered: Rendered) => /<caption class="dash-table-note">([^<]*)<\/caption>/.exec(rendered.html!)?.[1] ?? null;
    const all = renderView({ view: 'table', columns: ['country', 'year', 'growth_pct'] }, gdp, theme, 'gdp');
    expect([rows(all), note(all)]).toEqual([25, 'first 25 of 48 rows']);
    const forty = renderView({ view: 'table', limit: 40 }, gdp, theme, 'gdp');
    expect([rows(forty), note(forty)]).toEqual([40, null]);
    const filtered = renderView({ view: 'table', filter: [{ column: 'year', op: 'gt', value: 2022 }] }, gdp, theme, 'gdp');
    expect([rows(filtered), note(filtered)]).toEqual([16, null]);
    // past TABLE_VIEW_MAX_ROWS: the first 100 in the spec's order, N after filter, aggregation, sort and limit
    const many: ViewTable = { columns: [{ name: 'n', type: 'number' }], rows: Array.from({ length: 1_000 }, (_, i) => [i]) };
    const big = renderView({ view: 'table', limit: 500, sort: { by: 'n', dir: 'desc' } }, many, theme, 'n');
    expect([rows(big), note(big)]).toEqual([TABLE_VIEW_MAX_ROWS, 'first 100 of 500 rows']);
    expect(big.html).toContain('<tbody><tr><td class="dash-num">999</td></tr>');
  });

  it('answers the complete transformed view for inspection, the interpretation the view draws', () => {
    const counted = viewRows({ view: 'pie', x: 'island_ko', agg: 'count' }, penguins, 'penguins');
    expect(counted).toMatchObject({ ok: true, notes: [], table: { columns: [{ name: 'island_ko', type: 'string' }, { name: 'count', type: 'number' }], rows: [['토르게르센섬', 52], ['비스코섬', 168], ['드림섬', 124]] } });
    const projected = viewRows({ view: 'table', columns: ['growth_pct', 'country'], filter: [{ column: 'year', op: 'eq', value: 2024 }] }, gdp, 'gdp');
    expect(projected.ok && projected.table.columns.map((c) => c.name)).toEqual(['growth_pct', 'country']);
    expect(projected.ok && projected.table.rows).toHaveLength(8);
    expect(viewRows({ view: 'bar', x: 'nope' }, gdp, 'gdp')).toEqual({ ok: false, error: 'dataset "gdp" has no column "nope"' });
  });

  it('counts the rows of each group when the measure is the grouping column (x: region, y: region, agg: count)', () => {
    const t: ViewTable = { columns: [{ name: 'region', type: 'string' }], rows: [['A'], ['A'], ['B']] };
    const pie = renderView({ view: 'pie', x: 'region', y: 'region', agg: 'count' }, t, theme, 't');
    expect(tips(pie.svg!)).toEqual(['A: 2 (66.7%)', 'B: 1 (33.3%)']);
    const bar = renderView({ view: 'bar', x: 'region', y: 'region', agg: 'count' }, t, theme, 't');
    expect(tips(bar.svg!)).toEqual(['A · count of region: 2', 'B · count of region: 1']);
  });

  it('gives each measure its own format; a shared axis of unlike formats reads raw numbers', () => {
    const t: ViewTable = { columns: [{ name: 'x', type: 'string' }, { name: 'rate', type: 'number' }, { name: 'amount', type: 'number' }], rows: [['A', 0.1, 10]] };
    const { svg = '' } = renderView({ view: 'bar', x: 'x', y: ['rate', 'amount'], format: { rate: 'percent', amount: 'number' } }, t, theme, 't');
    expect(tips(svg!)).toEqual(['A · rate: 10%', 'A · amount: 10']);
    expect(svg).not.toContain('1000%');
    const texts = grade(svg!).texts;
    expect(texts).toEqual(expect.arrayContaining(['10%', '10'])); // each bar's label in its own format
    expect(texts.filter((label) => label.endsWith('%'))).toEqual(['10%']); // the axis is raw numbers
    const same = renderView({ view: 'bar', x: 'x', y: ['rate'], format: { rate: 'percent' } }, t, theme, 't');
    expect(grade(same.svg!).texts).toContain('0%'); // one format: the axis takes it
  });

  it('keeps typed series apart (1, "1", an empty cell and "(none)") and a lone filtered series in its own form', () => {
    const t: ViewTable = { columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 's', type: 'string' }], rows: [[1, 2, 1], [2, 3, '1'], [3, 4, null], [4, 5, '(none)']] };
    const { svg = '' } = renderView({ view: 'scatter', x: 'x', y: 'y', series: 's' }, t, theme, 't');
    expect(/<g>(.*?)<\/g>/.exec(svg!)![1].match(/<text/g)).toHaveLength(4);
    const bars: ViewTable = { columns: [{ name: 'x', type: 'string' }, { name: 'y', type: 'number' }, { name: 's', type: 'string' }], rows: [['cat', 1, 'A'], ['cat', 2, 'B']] };
    const spec = { view: 'bar', x: 'x', y: 'y', series: 's' };
    const marks = (out: string) => [...out.matchAll(/<path d="[^"]*" (fill="[^"]*"[^>]*?) data-tip="([^"]*)"\/>/g)].map((m) => [m[2], m[1]] as [string, string]);
    const both = new Map(marks(renderView(spec, bars, theme, 't').svg!));
    const alone = marks(renderView({ ...spec, filter: [{ column: 's', op: 'eq', value: 'B' }] }, bars, theme, 't').svg!);
    expect(alone).toEqual([['cat · y: 2', both.get('cat · B · y: 2')]]); // hollow, as beside A
  });

  it('counts and leaves out finite magnitudes no scale can span, x or y, never drawing NaN', () => {
    const t: ViewTable = { columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }], rows: [[-1.7e308, 1], [1.7e308, 2], [3, 4], [5, 1.7e308]] };
    for (const view of ['scatter', 'line', 'area']) {
      const { svg = '', warnings } = renderView({ view, x: 'x', y: 'y' }, t, theme, 't');
      expect(svg, view).not.toMatch(/NaN|Infinity/);
      expect(warnings, view).toContain('3 values are too large to draw');
      expect(grade(svg!).problems, view).toEqual([]);
    }
    const pie = renderView({ view: 'pie', x: 'x', y: 'y' }, { columns: t.columns, rows: [[1, 1e306], [2, 1e306], [3, 1e306]] }, theme, 't');
    expect(out(pie)).not.toMatch(/NaN|Infinity/);
  });
});

describe('numeric ranges no scale can draw (E2 panel)', () => {
  const subnormal: ViewTable = { columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }], rows: [[1, 1e-320], [2, 2e-320]] };

  it('draws a subnormal y range as the named state in place, the caption kept, never throwing', () => {
    for (const view of ['line', 'area', 'scatter', 'bar']) {
      let rendered: Rendered | undefined;
      expect(() => (rendered = renderView({ view, x: 'x', y: 'y', title: 'Tiny' }, subnormal, theme, 't')), view).not.toThrow();
      const svg = rendered!.svg!;
      expect(svg, view).toContain('y has a numeric range that cannot be drawn');
      expect(svg, view).toContain('aria-label="Tiny"');
      expect(svg, view).not.toMatch(/NaN|Infinity/);
      expect(grade(svg).problems, view).toEqual([]);
      expect(rendered!.warnings, view).toContain('y has a numeric range that cannot be drawn');
    }
  });

  it('names the x column when its numeric range cannot be drawn', () => {
    const t: ViewTable = { columns: [{ name: 'tiny', type: 'number' }, { name: 'v', type: 'number' }], rows: [[1e-320, 1], [2e-320, 2]] };
    for (const view of ['line', 'scatter']) {
      const { svg = '' } = renderView({ view, x: 'tiny', y: 'v' }, t, theme, 't');
      expect(svg, view).toContain('tiny has a numeric range that cannot be drawn');
    }
  });

  it('still draws a range just above the floor and a subnormal value beside ordinary ones', () => {
    const fine: ViewTable = { columns: subnormal.columns, rows: [[1, 0], [2, 1e-299]] };
    expect(renderView({ view: 'line', x: 'x', y: 'y' }, fine, theme, 't').svg).toContain('stroke-width="2"');
    expect(draw('edge-extreme').svg).not.toContain('cannot be drawn');
  });
});

describe('many series: labelled small multiples (parent Decision Log 27)', () => {
  const scatter = (t: ViewTable, over: Record<string, unknown> = {}) => renderView({ view: 'scatter', x: 'x', y: 'y', series: 's', ...over }, t, theme, 't');
  const textsOf = (body: string) => grade(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`).texts;

  it('draws seven series as seven labelled panels in snapshot order; filtered to S0 and S6, two panels named so, never a cycled form', () => {
    const seven = manySeries(7);
    const all = scatter(seven).svg!;
    expect(panels(all).map((p) => p.label)).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect(all).not.toContain('<g>'); // the panels' names carry identity, not a legend of forms
    const pair = scatter(seven, { filter: [{ column: 's', op: 'in', value: ['S0', 'S6'] }] }).svg!;
    const shown = panels(pair);
    expect(shown.map((p) => p.label)).toEqual(['S0', 'S6']);
    // each panel says its series' name in text and draws that series' values alone
    for (const p of shown) expect(textsOf(p.body)[0]).toBe(p.label);
    expect(layer(pair).map((point) => point.tip)).toEqual(['0 · S0 · y: 1', '1 · S0 · y: 2', '2 · S0 · y: 3', '0 · S6 · y: 7', '1 · S6 · y: 14', '2 · S6 · y: 21']);
    expect(grade(pair).problems).toEqual([]);
  });

  it('keeps one figure with a legend of distinct forms up to six identities, a filter keeping each survivor\'s form', () => {
    const six = scatter(manySeries(6)).svg!;
    expect(panels(six)).toEqual([]);
    const forms = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'].map((label) => formOf(six, label));
    expect(new Set(forms).size).toBe(6);
    const two = scatter(manySeries(6), { filter: [{ column: 's', op: 'in', value: ['S0', 'S5'] }] }).svg!;
    expect([formOf(two, 'S0'), formOf(two, 'S5')]).toEqual([forms[0], forms[5]]);
  });

  it('shares the axes and the scales: every panel the same grid, equal values at equal heights in a row, the x ticks alike', () => {
    const svg = scatter(manySeries(8)).svg!;
    const boxes = panels(svg).map((p) => boxOf(p.body));
    expect(boxes).toHaveLength(8);
    const relative = (b: (typeof boxes)[number]) => ({ width: Math.round((b.x1 - b.x0) * 100), rules: b.rules.map((y) => Math.round((y - b.top) * 100)) });
    for (const b of boxes) expect(relative(b)).toEqual(relative(boxes[0]));
    const points = layer(svg);
    const at = (tip: string) => points.find((p) => p.tip === tip)!;
    expect(at('1 · S0 · y: 2').y).toBe(at('0 · S1 · y: 2').y); // side by side in the first row, one height for one value
    expect(at('0 · S4 · y: 5').x).toBe(at('0 · S0 · y: 1').x); // S4 heads the second row, under S0
    // the y labels once per row, beside its first panel; the x ticks under the last panel of each column, all alike
    expect(grade(svg).texts.filter((t) => t === '20')).toHaveLength(2);
    const firstRow = panels(svg).slice(0, 4).map((p) => textsOf(p.body).slice(1));
    expect(firstRow).toEqual([[], [], [], []]);
    const lastRow = panels(svg).slice(4).map((p) => textsOf(p.body).slice(1));
    for (const ticks of lastRow) expect(ticks).toEqual(lastRow[0]);
    expect(lastRow[0].length).toBeGreaterThan(1);
  });

  it('draws 24 panels in six rows of four; a 25th series answers the named state, the view\'s rows still whole for inspection', () => {
    const svg = scatter(manySeries(24)).svg!;
    const boxes = panels(svg).map((p) => boxOf(p.body));
    expect(boxes).toHaveLength(24);
    expect(new Set(boxes.map((b) => b.x0)).size).toBe(4);
    expect(new Set(boxes.map((b) => b.top)).size).toBe(6);
    for (const b of boxes) expect(b.x1).toBeLessThanOrEqual(theme.width);
    const many = scatter(manySeries(25));
    expect(many.svg).toContain('too many series: 25; filter or aggregate');
    expect(many.warnings).toContain('too many series: 25; filter or aggregate');
    expect(panels(many.svg!)).toEqual([]);
    const inspected = viewRows({ view: 'scatter', x: 'x', y: 'y', series: 's' }, manySeries(25), 't');
    expect(inspected.ok && inspected.table.rows).toHaveLength(75);
    expect(panels(scatter(manySeries(25), { filter: [{ column: 's', op: 'ne', value: 'S7' }] }).svg!)).toHaveLength(24);
  });

  it('keeps sparse filtered identities in snapshot order under their own names', () => {
    const svg = scatter(manySeries(30), { filter: [{ column: 's', op: 'in', value: ['S29', 'S3', 'S17'] }] }).svg!;
    expect(panels(svg).map((p) => p.label)).toEqual(['S3', 'S17', 'S29']);
    expect(new Set(panels(svg).map((p) => boxOf(p.body).top)).size).toBe(1); // three columns, one row
  });

  it('names typed series apart: the number 1, the text "1", an empty cell and the text "(none)", in panels and in a legend', () => {
    const typed: ViewTable = { columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 's', type: 'string' }], rows: [[1, 2, 1], [2, 3, '1'], [3, 4, null], [4, 5, '(none)'], [5, 6, 'a'], [6, 7, 'b'], [7, 8, 'c']] };
    const qualified = ['1 (number)', '1 (text)', '(none) (empty)', '(none) (text)'];
    expect(panels(scatter(typed).svg!).map((p) => p.label)).toEqual([...qualified, 'a', 'b', 'c']);
    expect(layer(scatter(typed).svg!).map((p) => p.tip).slice(0, 2)).toEqual(['1 · 1 (number) · y: 2', '2 · 1 (text) · y: 3']);
    const four = scatter({ columns: typed.columns, rows: typed.rows.slice(0, 4) }).svg!;
    expect(grade(/<g>(.*?)<\/g>/.exec(four)![0]).texts).toEqual(qualified);
  });

  it('names series apart over the unfiltered domain: a generated name never takes a source label, and a filter never renames one (E2 M6)', () => {
    // the number 1 and the text "1" read alike and are qualified; a source value already reads "1 (number)"
    const typed: ViewTable = { columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 's', type: 'string' }], rows: [[1, 2, 1], [2, 3, '1'], [3, 4, '1 (number)']] };
    const legend = (svg: string) => grade(/<g>(.*?)<\/g>/.exec(svg)![0]).texts;
    const all = legend(scatter(typed).svg!);
    expect(all).toHaveLength(3);
    expect(new Set(all).size).toBe(3);
    expect(all).toContain('1 (number)');
    // ` · ` inside a series name meets a measure's: the duplicate's number is the unfiltered view's, kept under a filter
    const joined: ViewTable = { columns: [{ name: 'x', type: 'number' }, { name: 'r', type: 'number' }, { name: 'q · r', type: 'number' }, { name: 's', type: 'string' }], rows: [[1, 1, 2, 'p · q'], [1, 3, 4, 'p']] };
    const spec = { view: 'line', x: 'x', y: ['r', 'q · r'], series: 's' };
    const whole = legend(renderView(spec, joined, theme, 't').svg!);
    expect(whole).toEqual(['p · q · r', 'p · q · q · r', 'p · r', 'p · q · r (2)']);
    const filtered = legend(renderView({ ...spec, filter: [{ column: 's', op: 'eq', value: 'p' }] }, joined, theme, 't').svg!);
    expect(filtered).toEqual(['p · r', 'p · q · r (2)']);
    // a numbering suffix steps past a source label that already reads as it
    const suffixed: ViewTable = { columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'y (2)', type: 'number' }], rows: [[1, 1, 2]] };
    expect(legend(renderView({ view: 'line', x: 'x', y: ['y', 'y (2)', 'y'] }, suffixed, theme, 't').svg!)).toEqual(['y', 'y (2)', 'y (3)']);
  });

  it('draws a panel for each series and measure, each measure in its own format', () => {
    const t: ViewTable = {
      columns: [{ name: 'x', type: 'string' }, { name: 's', type: 'string' }, { name: 'rate', type: 'number' }, { name: 'amount', type: 'number' }],
      rows: ['a', 'b', 'c', 'd'].flatMap((name, i) => [['p', name, 0.1 * (i + 1), 10 * (i + 1)], ['q', name, 0.05, 5]]),
    };
    const { svg = '' } = renderView({ view: 'bar', x: 'x', y: ['rate', 'amount'], series: 's', format: { rate: 'percent' } }, t, theme, 't');
    expect(panels(svg).map((p) => p.label)).toEqual(['a · rate', 'a · amount', 'b · rate', 'b · amount', 'c · rate', 'c · amount', 'd · rate', 'd · amount']);
    expect(tips(svg).slice(0, 4)).toEqual(['p · a · rate: 10%', 'q · a · rate: 5%', 'p · a · amount: 10', 'q · a · amount: 5']);
    expect(grade(svg).problems).toEqual([]);
  });

  it('fits long Korean panel names inside their panels, wrapped and, past two lines, shortened with a note', () => {
    const { svg = '', warnings } = draw('facet-long-korean');
    expect(panels(svg)).toHaveLength(8);
    const shown = panels(svg).map((p, i) => {
      const box = boxOf(p.body);
      const title = /^<text x="([\d.]+)" y="[\d.]+"[^>]*>(.*?)<\/text>/.exec(p.body)!;
      expect(Number(title[1])).toBe(box.x0);
      const lines = title[2].includes('<tspan') ? [...title[2].matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g)].map((t) => t[1]) : [title[2]];
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const line of lines) expect(textWidth(line, theme.caption), line).toBeLessThanOrEqual(box.x1 - box.x0);
      // a shortened name keeps its beginning and its end, where names that share a long beginning differ
      expect(lines[0]).toMatch(/^제주특별자치도/);
      expect(lines.at(-1)).toMatch(new RegExp(`^….* ${i + 1}번 관측소$`));
      return lines.join(' ');
    });
    expect(new Set(shown).size).toBe(8);
    expect(warnings).toContain('some series names are shortened; the tips and the source table have them whole');
    expect(layer(svg)[0].tip).toBe('0 · 제주특별자치도 서귀포시 대정읍 마라도 등대 앞 선착장 1번 관측소 · y: 1'); // whole in the tip
  });

  it('places every hover point of a later panel inside that panel, its tip naming the series', () => {
    for (const view of ['line', 'scatter', 'area']) {
      const svg = renderView({ view, x: 'x', y: 'y', series: 's' }, manySeries(10, 5), theme, 't').svg!;
      const points = layer(svg);
      expect(points, view).toHaveLength(50);
      for (const p of panels(svg)) {
        const box = boxOf(p.body);
        const own = points.filter((point) => point.tip.includes(` · ${p.label} · `));
        expect(own, `${view} ${p.label}`).toHaveLength(5);
        for (const point of own) {
          expect(point.x, `${view} ${point.tip}`).toBeGreaterThanOrEqual(box.x0);
          expect(point.x, `${view} ${point.tip}`).toBeLessThanOrEqual(box.x1);
          expect(point.y, `${view} ${point.tip}`).toBeGreaterThanOrEqual(box.top);
          expect(point.y, `${view} ${point.tip}`).toBeLessThanOrEqual(box.bottom);
        }
      }
    }
  });
});

describe('aggregate overflow and renamed measures', () => {
  const huge: ViewTable = { columns: [{ name: 'g', type: 'string' }, { name: 'v', type: 'number' }], rows: [['A', 1.7e308], ['A', 1.7e308], ['B', 2]] };
  const NOTE = 'sum of v overflows in 1 group: too large to represent';

  it('names an overflowing sum in a table view: its cell and the table\'s note, never an unexplained dash', () => {
    const { html = '' } = renderView({ view: 'table', x: 'g', y: 'v', agg: 'sum' }, huge, theme, 't');
    expect(html).toContain(`<caption class="dash-table-note">${NOTE}</caption>`);
    expect(html).toContain('<tr><td>A</td><td class="dash-num">overflow</td></tr><tr><td>B</td><td class="dash-num">2</td></tr>');
    expect(html).not.toContain('—');
    expect(grade(html).problems).toEqual([]);
    const many: ViewTable = { columns: huge.columns, rows: [...huge.rows, ...Array.from({ length: 30 }, (_, i) => [`G${i}`, i])] };
    expect(renderView({ view: 'table', x: 'g', y: 'v', agg: 'sum' }, many, theme, 't').html).toContain(`<caption class="dash-table-note">first 25 of 32 rows · ${NOTE}</caption>`);
  });

  it('names an overflowing sum under a chart, not as a missing value', () => {
    for (const view of ['bar', 'line', 'pie']) {
      const { svg = '', warnings } = renderView({ view, x: 'g', y: 'v', agg: 'sum' }, huge, theme, 't');
      expect(warnings, view).toContain(NOTE);
      expect(warnings.join(' '), view).not.toMatch(/has no v|no positive v/);
      expect(svg, view).not.toMatch(/NaN|Infinity/);
    }
    const alone = renderView({ view: 'bar', x: 'g', y: 'v', agg: 'sum' }, { columns: huge.columns, rows: huge.rows.slice(0, 2) }, theme, 't');
    expect(alone.svg).toContain(NOTE); // nothing left to draw: the reason in place
  });

  it('answers the complete view for inspection with the overflow: the note and the cell', () => {
    const inspected = viewRows({ view: 'table', x: 'g', y: 'v', agg: 'sum', columns: ['v', 'g'] }, huge, 't');
    if (!inspected.ok) throw new Error(inspected.error);
    expect(inspected.table.rows).toEqual([[null, 'A'], [2, 'B']]);
    expect(inspected.notes).toEqual([NOTE]);
    expect([inspected.overflowed(0, 0), inspected.overflowed(0, 1), inspected.overflowed(1, 0)]).toEqual([true, false, false]);
  });

  it('formats a measure renamed apart from its grouping column as its source column asks, else by its own name', () => {
    const t: ViewTable = { columns: [{ name: 'rate', type: 'number' }], rows: [[0.1], [0.1], [0.2]] };
    const table = renderView({ view: 'table', x: 'rate', y: 'rate', agg: 'mean', columns: ['mean of rate'], format: { rate: 'percent' } }, t, theme, 't').html!;
    expect(table).toContain('<td class="dash-num">10%</td>');
    expect(table).toContain('<td class="dash-num">20%</td>');
    const bar = renderView({ view: 'bar', x: 'rate', y: 'rate', agg: 'mean', format: { rate: 'percent' } }, t, theme, 't').svg!;
    expect(tips(bar)).toEqual(['10% · mean of rate: 10%', '20% · mean of rate: 20%']);
    const own = renderView({ view: 'table', x: 'rate', y: 'rate', agg: 'mean', columns: ['mean of rate'], format: { 'mean of rate': 'percent' } }, t, theme, 't').html!;
    expect(own).toContain('<td class="dash-num">10%</td>');
  });
});

// P3-F dashboard-model wave: what valid data the figure must still say, whatever its words or its size.
describe('labels and values at their edges (P3-F dashboard-model wave)', () => {
  /** The legend's labels, in its order. */
  const legendLabels = (svg: string) => [.../<g>(.*?)<\/g>/.exec(svg)![1].matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

  // sweep#1: a whitespace-only text is a valid cell, a category or a series with no words to wrap
  const blank: ViewTable = { columns: [{ name: 'k', type: 'string' }, { name: 's', type: 'string' }, { name: 'v', type: 'number' }], rows: [[' ', ' ', 1], ['b', 'B', 2]] };
  it('draws a blank pie category as an empty label in the list, its tip whole, never throwing', () => {
    const pie = renderView({ view: 'pie', x: 'k', y: 'v' }, blank, theme, 't');
    expect(tips(pie.svg!)).toEqual([' : 1 (33.3%)', 'b: 2 (66.7%)']);
    expect(grade(pie.svg!).problems).toEqual([]);
    expect(pie.svg).not.toMatch(/undefined|NaN/);
  });

  it('draws a blank series as an empty label in the legend, never throwing', () => {
    for (const view of ['bar', 'line']) {
      const { svg = '' } = renderView({ view, x: 'k', y: 'v', series: 's' }, blank, theme, 't');
      expect(legendLabels(svg), view).toEqual(['', 'B']);
      expect(grade(svg).problems, view).toEqual([]);
      expect(svg, view).not.toMatch(/undefined|NaN/);
    }
  });

  // sweep#2: a measure too small for two decimals keeps its significant figures and its sign wherever its value is said
  const small: ViewTable = { columns: [{ name: 'k', type: 'string' }, { name: 'v', type: 'number' }], rows: [['a', 0.001], ['b', -0.001], ['c', 1e-5]] };
  it('says a small nonzero measure with its magnitude and sign: a table cell, a tip and the export preview', () => {
    const said = ['0.001', '−0.001', '0.00001'];
    const html = renderView({ view: 'table' }, small, theme, 't').html!;
    expect([...html.matchAll(/<td class="dash-num">([^<]*)<\/td>/g)].map((m) => m[1])).toEqual(said);
    expect(tips(renderView({ view: 'bar', x: 'k', y: 'v' }, small, theme, 't').svg!)).toEqual(said.map((v, i) => `${'abc'[i]} · v: ${v}`));
    expect(layer(renderView({ view: 'line', x: 'k', y: 'v' }, small, theme, 't').svg!).map((point) => point.tip)).toEqual(said.map((v, i) => `${'abc'[i]} · v: ${v}`));
    const preview = viewPreview({ view: 'bar', x: 'k', y: 'v' }, small, 't');
    expect(preview.ok && preview.table.rows).toEqual(said.map((v, i) => ['abc'[i], v]));
    // in percent too: 0.001% is not 0%
    const percent = renderView({ view: 'table', format: { v: 'percent' } }, small, theme, 't').html!;
    expect([...percent.matchAll(/<td class="dash-num">([^<]*)<\/td>/g)].map((m) => m[1])).toEqual(['0.1%', '−0.1%', '0.001%']);
  });

  // sweep#3: a pie of two measures is the view's error in place, never the first measure drawn and the second dropped
  it('draws a pie of more than one measure as the error naming the rest; a pie of one measure as before', () => {
    const t: ViewTable = { columns: [{ name: 'region', type: 'string' }, { name: 'sales', type: 'number' }, { name: 'cost', type: 'number' }], rows: [['N', 3, 1], ['S', 1, 2]] };
    const two = renderView({ view: 'pie', x: 'region', y: ['sales', 'cost'], title: 'Mix' }, t, theme, 't');
    expect(two.warnings).toEqual(['a pie view draws one measure; y also names "cost"']);
    expect(two.svg).toContain('<title>Mix</title>');
    expect(tips(two.svg!)).toEqual([]);
    expect(viewPreview({ view: 'pie', x: 'region', y: ['sales', 'cost'] }, t, 't')).toEqual({ ok: false, error: 'a pie view draws one measure; y also names "cost"' });
    const one = renderView({ view: 'pie', x: 'region', y: ['sales'] }, t, theme, 't');
    expect(tips(one.svg!)).toEqual(['N: 3 (75%)', 'S: 1 (25%)']);
    expect(one).toEqual(renderView({ view: 'pie', x: 'region', y: 'sales' }, t, theme, 't'));
  });
});
