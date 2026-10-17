// P3-E2 M1 (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md): derives the comparison's three tables from the raw
// downloads under raw/, verbatim, and prints each output's sha256. Derivation only reshapes and translates labels: it
// never invents, rounds or fills an observation. Run from anywhere: `node spikes/p3-dashboard/datasets/derive.mjs`.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = (name) => readFileSync(join(here, 'raw', name), 'utf8');
const out = (name, rows) => {
  const text = `${rows.map((row) => row.join(',')).join('\n')}\n`;
  writeFileSync(join(here, name), text);
  console.log(`${createHash('sha256').update(text).digest('hex')}  ${name}  ${rows.length - 1} rows`);
};
const missing = (value) => (value === '***' || value === 'NA' ? '' : value);

// GISTEMP v4: line 1 is a title, line 2 the header; `***` marks a month or season not yet available.
const gistemp = raw('gistemp-v4-GLB.Ts+dSST.csv').trim().split('\n').slice(1).map((line) => line.split(','));
const [head, ...years] = gistemp;
const col = (name) => head.indexOf(name);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
out('gistemp-monthly.csv', [
  ['date', 'anomaly_c'],
  ...years.flatMap((row) => MONTHS.map((month, i) => [`${row[0]}-${String(i + 1).padStart(2, '0')}-01`, missing(row[col(month)])])),
]);
out('gistemp-annual.csv', [['year', 'annual_c', 'djf_c', 'jja_c'], ...years.map((row) => [row[0], missing(row[col('J-D')]), missing(row[col('DJF')]), missing(row[col('JJA')])])]);

// World Bank WDI, NY.GDP.MKTP.KD.ZG (GDP growth, annual %), eight economies, 2019 to 2024; Korean names a derivative.
const KO = { KOR: '대한민국', JPN: '일본', USA: '미국', DEU: '독일', GBR: '영국', FRA: '프랑스', ITA: '이탈리아', CAN: '캐나다' };
const [, records] = JSON.parse(raw('worldbank-NY.GDP.MKTP.KD.ZG-2019-2024.json'));
const gdp = records
  .map((r) => [r.country.value.includes(',') ? `"${r.country.value}"` : r.country.value, KO[r.countryiso3code], r.countryiso3code, r.date, r.value === null ? '' : String(r.value)])
  .sort((a, b) => a[2].localeCompare(b[2]) || a[3].localeCompare(b[3]));
out('gdp-growth.csv', [['country', 'country_ko', 'iso3', 'year', 'growth_pct'], ...gdp]);

// palmerpenguins (CC0): `NA` becomes an empty cell (null); species and island gain Korean names (a derivative).
const SPECIES = { Adelie: '아델리펭귄', Gentoo: '젠투펭귄', Chinstrap: '턱끈펭귄' };
const ISLAND = { Torgersen: '토르게르센섬', Biscoe: '비스코섬', Dream: '드림섬' };
const [pHead, ...penguins] = raw('palmerpenguins-penguins.csv').trim().split('\n').map((line) => line.split(','));
out('penguins.csv', [
  [pHead[0], 'species_ko', pHead[1], 'island_ko', ...pHead.slice(2)],
  ...penguins.map((row) => [row[0], SPECIES[row[0]], row[1], ISLAND[row[1]], ...row.slice(2).map(missing)]),
]);
