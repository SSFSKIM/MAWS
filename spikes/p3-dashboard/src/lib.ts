// P3-E2 M1 spike: what the e2e proof and the measurements load as one bundle (built by e2e/build.mjs, the datasets
// embedded as text): the cases, both candidates' renderers, the house theme and each view's source label.
import { HOUSE_TOKENS } from '../../../src/artifacts/document/export/design-system';
import annual from '../datasets/gistemp-annual.csv';
import gdp from '../datasets/gdp-growth.csv';
import monthly from '../datasets/gistemp-monthly.csv';
import penguins from '../datasets/penguins.csv';
import { cases } from './fixtures';
import { d3Kit } from './kit-d3';
import { houseKit } from './kit-house';
import { makeRenderer } from './render';
import { themeFrom } from './svg';

export const texts = { monthly, annual, gdp, penguins };
export const CASES = cases(texts);
export const theme = themeFrom(HOUSE_TOKENS.properties).theme;
export const renderers = { d3: makeRenderer(d3Kit), house: makeRenderer(houseKit) };
export type Candidate = keyof typeof renderers;

const SOURCES: Record<string, { title: string; file: string }> = {
  gistemp: { title: 'GISTEMP v4, monthly', file: 'gistemp-monthly.csv' },
  gistemp_annual: { title: 'GISTEMP v4, annual', file: 'gistemp-annual.csv' },
  gdp: { title: 'World Bank WDI, GDP growth', file: 'gdp-growth.csv' },
  penguins: { title: 'Palmer penguins', file: 'penguins.csv' },
};

/** The source label a host draws under a view (the snapshot time is the vendored download's). */
export function sourceLabel(datasetId: string): string {
  const source = SOURCES[datasetId] ?? { title: datasetId, file: `${datasetId}.csv` };
  return `${source.title} · from ${source.file} · updated 2026-10-16 10:00 UTC by Claude`;
}

export function renderAll(candidate: Candidate): { id: string; svg: string; warnings: string[] }[] {
  return CASES.map((c) => ({ id: c.id, ...renderers[candidate](c.spec, c.table, theme, c.datasetId) }));
}
export { textWidth } from './text';
