// The renderer's binding grade (P3-E2 M3; parent §2 "Views"): every view kind in Node, byte-equal for equal inputs in
// any time zone, nothing executable or referencing in the output (hostile labels, specs and themes included), named
// figures, and the data semantics' actual values over real data (M1's vendored World Bank and penguin tables, parsed by
// the host's own parser).
import { describe, expect, it, vi } from 'vitest';
import { HOUSE_TOKENS } from '../../document/export/design-system';
import { parseDataset, DatasetError } from '../parse';
import { GDP_CSV, PENGUINS_CSV } from '../fixtures/datasets';
import { renderFailure, renderView, themeFrom, TABLE_VIEW_MAX_ROWS, viewRows, type Rendered, type ViewTable } from './index';
import { textWidth } from './text';

const table = (csv: string): ViewTable => {
  const parsed = parseDataset(new TextEncoder().encode(csv), 'csv');
  if (parsed instanceof DatasetError) throw new Error(parsed.reason);
  return parsed;
};
const gdp = table(GDP_CSV);
const penguins = table(PENGUINS_CSV);
const theme = themeFrom(HOUSE_TOKENS.properties).theme;

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

  it('keeps series identity from the unfiltered snapshot: a filter never changes a surviving series\' form', () => {
    const style = (svg: string, label: string) => {
      const legend = /<g>(.*?)<\/g>/.exec(svg)![1];
      const at = legend.indexOf(`>${label}</text>`);
      return /stroke-dasharray="([^"]*)"/.exec(legend.slice(legend.lastIndexOf('<path d="M', at), at))?.[1] ?? 'solid';
    };
    const three = draw('line-gdp-three').svg;
    const two = renderView({ ...(byId('line-gdp-three').spec as object), filter: [{ column: 'iso3', op: 'in', value: ['KOR', 'USA'] }] }, gdp, theme, 'gdp').svg!;
    for (const name of ['대한민국', '미국']) expect(style(two, name), name).toBe(style(three, name));
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
    expect(list).toEqual(['2026-10-16 00:00 UTC · v: 1', '2026-10-16 00:30 UTC · v: 2', '2026-10-16 · v: 3', '2026-10-16 · v: 4']);
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
    const hostile = themeFrom({ '--ds-color-text': 'red" onload="alert(1)', '--ds-font-body': 'x;}</style><script>', '--ds-color-border': 'url(https://e.example/x)', '--ds-type-caption-size': '0px', '--ds-type-body-size': '16px' });
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
    expect(counted).toEqual({ ok: true, table: { columns: [{ name: 'island_ko', type: 'string' }, { name: 'count', type: 'number' }], rows: [['토르게르센섬', 52], ['비스코섬', 168], ['드림섬', 124]] } });
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
