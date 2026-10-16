// P3-E2 M1 spike: the closed inputs both candidates render. Real views over the three vendored datasets
// (datasets/SOURCES.txt), the edge cases (empty, one row, negative, null, missing column, unknown kind, hostile text,
// extreme numbers, long Korean labels), and the one synthetic input, the 10,000-point stress, named as such.
import { parseCsv, type Table } from './model';

export interface DatasetTexts {
  monthly: string;
  annual: string;
  gdp: string;
  penguins: string;
}
export interface Case {
  id: string;
  datasetId: string;
  spec: unknown;
  table: Table | null;
  /** Shown in the comparison sheets and the export proof (the rest are unit-only). */
  sheet?: boolean;
}

/** The synthetic stress input: a deterministic 10,000-point random walk (an LCG, seeded), never real data. */
export function syntheticWalk(n = 10_000): Table {
  let seed = 20261016;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let level = 0;
  const rows = Array.from({ length: n }, (_, i) => {
    level += next() - 0.5;
    return [i, Math.round(level * 1000) / 1000, next() * 100, i % 3 === 0 ? 'a' : i % 3 === 1 ? 'b' : 'c'];
  });
  return { columns: [{ name: 'step', type: 'number' }, { name: 'level', type: 'number' }, { name: 'noise', type: 'number' }, { name: 'group', type: 'string' }], rows };
}

const LONG: Table = {
  columns: [{ name: '지역 이름이 아주 긴 행정 구역의 공식 명칭', type: 'string' }, { name: '값', type: 'number' }],
  rows: [['서울특별시 종로구 세종대로 이백구 정부서울청사 별관', 12], ['부산광역시 해운대구', 7], ['제주특별자치도 서귀포시 대정읍 마라도 등대 앞 선착장', 3]],
};

export function cases(texts: DatasetTexts): Case[] {
  const monthly = parseCsv(texts.monthly);
  const annual = parseCsv(texts.annual);
  const gdp = parseCsv(texts.gdp);
  const penguins = parseCsv(texts.penguins);
  const empty: Table = { columns: gdp.columns, rows: [] };
  const one: Table = { columns: gdp.columns, rows: gdp.rows.slice(0, 1) };
  return [
    // Real views (the comparison sheets)
    { id: 'line-gistemp-monthly', datasetId: 'gistemp', table: monthly, sheet: true, spec: { view: 'line', x: 'date', y: 'anomaly_c', title: '전 지구 월평균 기온 편차 (°C, 1951–1980 평균 대비)' } },
    { id: 'area-gistemp-annual', datasetId: 'gistemp_annual', table: annual, sheet: true, spec: { view: 'area', x: 'year', y: 'annual_c', format: { year: 'text' }, title: 'Global annual temperature anomaly, °C' } },
    { id: 'line-gistemp-seasons', datasetId: 'gistemp_annual', table: annual, sheet: true, spec: { view: 'line', x: 'year', y: ['djf_c', 'jja_c'], filter: [{ column: 'year', op: 'gt', value: 1979 }], format: { year: 'text' }, title: '겨울(DJF)과 여름(JJA) 기온 편차, 1980년 이후' } },
    { id: 'bar-gdp-2024', datasetId: 'gdp', table: gdp, sheet: true, spec: { view: 'bar', x: 'country_ko', y: 'growth_pct', filter: [{ column: 'year', op: 'eq', value: 2024 }], sort: { by: 'growth_pct', dir: 'desc' }, title: '2024년 실질 GDP 성장률 (%)' } },
    { id: 'line-gdp-three', datasetId: 'gdp', table: gdp, sheet: true, spec: { view: 'line', x: 'year', y: 'growth_pct', series: 'country_ko', filter: [{ column: 'iso3', op: 'in', value: ['KOR', 'JPN', 'USA'] }], format: { year: 'text' }, title: '대한민국·일본·미국 GDP 성장률, 2019–2024 (%)' } },
    { id: 'bar-penguins-mass', datasetId: 'penguins', table: penguins, sheet: true, spec: { view: 'bar', x: 'species_ko', y: 'body_mass_g', series: 'sex', agg: 'mean', filter: [{ column: 'sex', op: 'in', value: ['female', 'male'] }], title: '종과 성별에 따른 평균 체중 (g)' } },
    { id: 'scatter-penguins', datasetId: 'penguins', table: penguins, sheet: true, spec: { view: 'scatter', x: 'flipper_length_mm', y: 'body_mass_g', series: 'species_ko', title: 'Flipper length and body mass of 344 penguins' } },
    { id: 'pie-penguins-island', datasetId: 'penguins', table: penguins, sheet: true, spec: { view: 'pie', x: 'island_ko', agg: 'count', title: '섬별 관측 개체 수' } },
    { id: 'table-gdp-2020', datasetId: 'gdp', table: gdp, sheet: true, spec: { view: 'table', columns: ['country_ko', 'country', 'growth_pct'], filter: [{ column: 'year', op: 'eq', value: 2020 }], sort: { by: 'growth_pct', dir: 'asc' }, title: '2020년 성장률, 낮은 순' } },
    // Edge cases
    { id: 'edge-empty-bar', datasetId: 'gdp', table: empty, spec: { view: 'bar', x: 'country_ko', y: 'growth_pct' } },
    { id: 'edge-empty-line', datasetId: 'gdp', table: empty, spec: { view: 'line', x: 'year', y: 'growth_pct' } },
    { id: 'edge-empty-table', datasetId: 'gdp', table: empty, spec: { view: 'table' } },
    { id: 'edge-one-line', datasetId: 'gdp', table: one, spec: { view: 'line', x: 'year', y: 'growth_pct' } },
    { id: 'edge-one-pie', datasetId: 'gdp', table: one, spec: { view: 'pie', x: 'country', y: 'growth_pct' } },
    { id: 'edge-one-scatter', datasetId: 'gdp', table: one, spec: { view: 'scatter', x: 'year', y: 'growth_pct' } },
    { id: 'edge-negative-bar', datasetId: 'gdp', table: gdp, spec: { view: 'bar', x: 'country_ko', y: 'growth_pct', filter: [{ column: 'year', op: 'eq', value: 2020 }] } },
    { id: 'edge-null-gaps', datasetId: 'gistemp', table: monthly, spec: { view: 'line', x: 'date', y: 'anomaly_c', filter: [{ column: 'date', op: 'gt', value: '2025-06-01' }] } },
    { id: 'edge-missing-column', datasetId: 'gdp', table: gdp, spec: { view: 'bar', x: 'country', y: 'inflation' } },
    { id: 'edge-no-dataset', datasetId: 'sales', table: null, spec: { view: 'bar', x: 'month', y: 'total', title: 'Monthly sales' } },
    { id: 'edge-unknown-view', datasetId: 'gdp', table: gdp, spec: { view: 'sankey', title: 'Flows' } },
    {
      id: 'edge-hostile',
      datasetId: 'gdp',
      table: { columns: [{ name: 'name', type: 'string' }, { name: 'v', type: 'number' }], rows: [['</text><script>alert(1)</script>', 1], ['" onload="alert(2)', 2], ['<a href="https://evil.example/">x</a>', 3], ['&amp; ]]> <!-- \u0000\u0007', 4]] },
      spec: { view: 'bar', x: 'name', y: 'v', title: '<script>alert("t")</script> javascript:alert(3)', onclick: 'alert(4)', href: 'https://evil.example/' },
    },
    {
      id: 'edge-extreme',
      datasetId: 'x',
      table: { columns: [{ name: 'k', type: 'string' }, { name: 'v', type: 'number' }], rows: [['max', 1.7976931348623157e308], ['tiny', 5e-324], ['neg', -1e300], ['zero', 0]] },
      spec: { view: 'bar', x: 'k', y: 'v' },
    },
    { id: 'edge-long-korean', datasetId: 'regions', table: LONG, spec: { view: 'bar', x: LONG.columns[0].name, y: '값', title: '이름이 긴 행정 구역별 값의 비교 — 줄바꿈과 잘림 없이' } },
    { id: 'edge-long-korean-table', datasetId: 'regions', table: LONG, spec: { view: 'table' } },
    // The synthetic stress input (10,000 points)
    { id: 'stress-line-10k', datasetId: 'synthetic', table: syntheticWalk(), spec: { view: 'line', x: 'step', y: 'level', title: 'Synthetic random walk, 10,000 points' } },
    { id: 'stress-scatter-10k', datasetId: 'synthetic', table: syntheticWalk(), spec: { view: 'scatter', x: 'step', y: 'noise', series: 'group', title: 'Synthetic scatter, 10,000 points' } },
  ];
}
