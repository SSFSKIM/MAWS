// P3-E2 M1 spike: the comparison's measured rows, run on CI only (`pnpm e2e:dashboard-spike-scale`, which sets
// MAWS_DASHBOARD_SCALE=1 inline; the Mac lane, one job at a time). Records the machine and its load, then:
//   bundle  each candidate as it would ship (renderer + Kit + theme reader) and each Kit alone, production-minified by
//           esbuild (the minifier electron-vite runs), raw, gzip -9 and brotli bytes, and the bytes each package adds;
//   code    the custom numerical/geometry lines each candidate carries (non-blank, non-comment);
//   time    every real view and the two synthetic 10,000-point views, rendered in Node from the minified bundle:
//           warm-up 5, then 30 timed runs each (median, p95, max), and the heap after.
// It first waits (up to 5 min) for the one-minute load to fall below 10. Evidence lines start `SPIKE-MEASURE ` (JSON);
// a load still at or above 10 is reported as not quiet, never a pass.
import { build } from 'esbuild';
import { cpus, hostname, loadavg, totalmem } from 'node:os';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

if (process.env.MAWS_DASHBOARD_SCALE !== '1') {
  console.log('measure: skipped (MAWS_DASHBOARD_SCALE is not 1)');
  process.exit(0);
}
const spike = dirname(fileURLToPath(import.meta.url));
const out = join(spike, 'out');
const emit = (key, value) => console.log(`SPIKE-MEASURE ${JSON.stringify({ key, value })}`);
const load = () => loadavg().map((n) => Number(n.toFixed(2)));

emit('machine', { host: hostname(), cpu: cpus()[0]?.model, cores: cpus().length, memoryGiB: Math.round(totalmem() / 2 ** 30), node: process.version, platform: `${process.platform}-${process.arch}`, load: load() });

// The settle wait: a build just before this job (the e2e lane's) leaves the one-minute load high for a minute or two.
// Poll every 10 s, up to 5 min, until it is below 10; every reading is recorded.
const readings = [];
for (const start = Date.now(); ; ) {
  readings.push({ s: Math.round((Date.now() - start) / 1000), load: load() });
  if (loadavg()[0] < 10 || Date.now() - start >= 300_000) break;
  await new Promise((done) => setTimeout(done, 10_000));
}
emit('settle', readings);
if (loadavg()[0] >= 10) emit('quiet', `NOT QUIET: one-minute load ${loadavg()[0].toFixed(2)} >= 10 after the 5 min wait; the timings below are not a pass`);

// ---- bundle ----
const bundle = async (name, contents) => {
  const result = await build({ stdin: { contents, resolveDir: spike, loader: 'ts' }, bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'chrome140', write: false, metafile: true, tsconfig: join(spike, 'tsconfig.json'), legalComments: 'none', logLevel: 'warning' });
  const code = result.outputFiles[0].contents;
  const output = Object.values(result.metafile.outputs)[0];
  const byPackage = {};
  for (const [path, { bytesInOutput }] of Object.entries(output.inputs)) {
    const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(path)?.[1] ?? 'spike';
    byPackage[pkg] = (byPackage[pkg] ?? 0) + bytesInOutput;
  }
  emit(`bundle-${name}`, { raw: code.length, gzip: gzipSync(code, { level: 9 }).length, brotli: brotliCompressSync(code, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length, byPackage });
  return code;
};
await bundle('d3-renderer', "export * from './src/entry-d3.ts';");
await bundle('house-renderer', "export * from './src/entry-house.ts';");
await bundle('d3-kit-only', "export { d3Kit } from './src/kit-d3.ts';");
await bundle('house-kit-only', "export { houseKit } from './src/kit-house.ts';");

// ---- custom code ----
const lines = (file) => readFileSync(join(spike, file), 'utf8').split('\n').filter((l) => l.trim() !== '' && !/^\s*(\/\/|\/\*|\*)/.test(l)).length;
emit('code-lines', { 'kit-d3.ts': lines('src/kit-d3.ts'), 'kit-house.ts': lines('src/kit-house.ts'), 'shared render.ts': lines('src/render.ts'), 'shared text.ts': lines('src/text.ts'), 'shared svg.ts': lines('src/svg.ts'), 'shared transform.ts': lines('src/transform.ts'), 'shared spec.ts': lines('src/spec.ts') });

// ---- time ----
const lib = await build({ entryPoints: [join(spike, 'src/lib.ts')], bundle: true, minify: true, format: 'esm', platform: 'node', target: 'node22', outfile: join(out, 'measure-lib.mjs'), loader: { '.csv': 'text' }, tsconfig: join(spike, 'tsconfig.json'), logLevel: 'warning' });
void lib;
const { CASES, renderers, theme } = await import(pathToFileURL(join(out, 'measure-lib.mjs')).href);
const timed = CASES.filter((c) => c.sheet || c.id.startsWith('stress-'));
for (const candidate of ['d3', 'house']) {
  const render = renderers[candidate];
  const rows = {};
  for (const c of timed) {
    for (let i = 0; i < 5; i += 1) render(c.spec, c.table, theme, c.datasetId);
    const ms = [];
    let bytes = 0;
    for (let i = 0; i < 30; i += 1) {
      const t0 = performance.now();
      bytes = render(c.spec, c.table, theme, c.datasetId).svg.length;
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    rows[c.id] = { median: Number(ms[15].toFixed(2)), p95: Number(ms[Math.ceil(0.95 * 30) - 1].toFixed(2)), max: Number(ms[29].toFixed(2)), svgBytes: bytes };
  }
  emit(`time-${candidate}`, rows);
}
emit('heap', { usedMiB: Math.round(process.memoryUsage().heapUsed / 2 ** 20), rssMiB: Math.round(process.memoryUsage().rss / 2 ** 20) });
emit('load-after', load());
