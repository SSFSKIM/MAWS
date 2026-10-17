// The dashboard's scale bench (P3-E2 M6 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md, acceptance 7): a
// synthetic, seeded 50,000-row sales ledger (an LCG, so every run binds the same bytes for one variant; explicitly
// synthetic, never observations) and the twelve views `e2e/dashboard-scale.spec.ts` draws over it, every view kind among
// them: aggregated lines, bars, an area and a pie, three tables (the default 25-row preview, an explicit 100, an
// aggregate) and one scatter of exactly 10,000 points, the row "one view of 10,000 points renders". A variant changes
// the values, not the shape, so a replacement binds new bytes the same views draw.

export const BENCH_ROWS = 50_000;
export const BENCH_DATASET = 'ledger';
/** The scatter's points: the spec's `limit`, the row the 10,000-point render bound reads. */
export const BENCH_SCATTER_POINTS = 10_000;

const REGIONS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '제주'] as const;
const CHANNELS = ['online', 'store', 'partner', 'phone'] as const;
const DAYS = 730; // 2025-01-01 and the 729 days after it

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const dayOf = (k: number) => {
  const at = new Date(Date.UTC(2025, 0, 1) + k * 86_400_000);
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1, 2)}-${pad(at.getUTCDate(), 2)}`;
};

/** The ledger as CSV: `order_id,day,region,channel,units,revenue,margin,returned`, `rows` rows, its values by `variant`. */
export function benchCsv(rows = BENCH_ROWS, variant = 0): string {
  let seed = 20261016 + variant * 7919;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const lines = ['order_id,day,region,channel,units,revenue,margin,returned'];
  for (let i = 0; i < rows; i++) {
    const units = 1 + Math.floor(next() * 500);
    const price = 1_000 + Math.floor(next() * 49_000);
    const margin = Math.round((next() * 0.8 - 0.2) * 1_000) / 1_000;
    lines.push([`O-${pad(i + 1, 6)}`, dayOf(i % DAYS), REGIONS[Math.floor(next() * REGIONS.length)], CHANNELS[Math.floor(next() * CHANNELS.length)], units, units * price, margin, next() < 0.07 ? 'true' : 'false'].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** The twelve views over the ledger, in the order the dashboard draws them. */
export const BENCH_VIEWS: readonly Record<string, unknown>[] = [
  { view: 'line', x: 'day', y: 'revenue', agg: 'sum', title: '일별 매출' },
  { view: 'bar', x: 'region', y: 'revenue', agg: 'sum', sort: { by: 'revenue', dir: 'desc' }, title: '지역별 매출' },
  { view: 'bar', x: 'channel', y: 'units', agg: 'sum', series: 'region', title: '채널과 지역별 판매량' },
  { view: 'area', x: 'day', y: 'units', agg: 'sum', filter: [{ column: 'region', op: 'eq', value: '서울' }], title: '서울의 일별 판매량' },
  { view: 'scatter', x: 'units', y: 'revenue', limit: BENCH_SCATTER_POINTS, title: '주문 1만 건의 수량과 매출' },
  { view: 'pie', x: 'channel', y: 'revenue', agg: 'sum', title: '채널별 매출 비중' },
  { view: 'table', columns: ['order_id', 'day', 'region', 'revenue'], sort: { by: 'revenue', dir: 'desc' }, limit: 100, title: '매출 상위 100건' },
  { view: 'table', title: '주문 원장' },
  { view: 'bar', x: 'region', y: 'margin', agg: 'mean', format: { margin: 'percent' }, title: '지역별 평균 마진' },
  { view: 'line', x: 'day', y: 'margin', agg: 'mean', series: 'channel', title: '채널별 일평균 마진' },
  { view: 'bar', x: 'region', agg: 'count', filter: [{ column: 'returned', op: 'eq', value: true }], title: '지역별 반품 건수' },
  { view: 'table', x: 'region', y: ['units', 'revenue'], agg: 'sum', title: '지역별 합계' },
];

/** The dashboard's markdown, as an agent's artifact_create writes it: a heading, a paragraph and the twelve views. */
export function benchMarkdown(dataset = BENCH_DATASET): string {
  const views = BENCH_VIEWS.flatMap((spec, k) => [`:::chart {spec-json='${JSON.stringify(spec)}'}`, dataset, ':::', `^v${k + 1}`, '']);
  return ['# 판매 원장 대시보드 ^h1', '', 'Twelve views over 50,000 orders. ^p1', '', ...views].join('\n');
}
