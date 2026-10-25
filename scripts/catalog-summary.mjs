// The Discover catalog's live summary (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M2): a dev-only
// command, never run by a gate or by MAWS. It walks the catalog's real network sources once through the catalog's own
// code (src/main/catalog: the store, its fetches through `egressGet` under the `catalog` egress rule, the parsers and
// the join), with no engine reads, into a scratch cache it removes after, and prints what they hold: per source the
// records, the catalog's counts, the taxonomy axes' coverage, and every request's size, type and time (the rule's caps).
//
//   node scripts/catalog-summary.mjs [--out <file.json>]
//
// GET only, no credentials, to the four routes the rule admits; run it once per measurement.
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv.includes('--out') ? resolve(process.argv[process.argv.indexOf('--out') + 1]) : null;
const { version } = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));

const ENTRY = `
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG_EGRESS, egressGet } from './src/shared/net/egress';
import { NETWORK_KEYS, networkPages } from './src/main/catalog/fetch';
import { buildCatalog } from './src/main/catalog/join';
import { CatalogStore } from './src/main/catalog/store';
import { catalogSummary } from './src/main/catalog/summary';

const cache = mkdtempSync(join(tmpdir(), 'maws-catalog-summary-'));
try {
  const lines = [];
  const store = new CatalogStore({ dir: cache, keys: NETWORK_KEYS, pages: networkPages(egressGet(CATALOG_EGRESS), process.env.CATALOG_SUMMARY_UA), log: (line) => lines.push(line) });
  const started = Date.now();
  const statuses = await store.refresh();
  const network = store.data();
  const items = buildCatalog({ network, engine: null, tests: [] });
  // the raw shape of the remote Claude Code servers the catalog does not show, read from the walk's own copy
  const raw = JSON.parse(readFileSync(join(cache, 'directory:servers.json'), 'utf8')).pages.flatMap((page) => page.servers ?? []);
  const unshown = raw.filter((s) => s.type === 'remote' && (s.works_with ?? []).includes('claude-code') && !items.some((i) => i.id === s.id));
  const shape = (s) => ['url', 'url_regex', 'transport'].map((field) => field + ':' + (s.remote === null || s.remote === undefined ? 'no remote' : s.remote[field] === null ? 'null' : Array.isArray(s.remote[field]) ? 'array' : typeof s.remote[field] === 'string' ? (field === 'transport' ? s.remote[field] : 'string') : typeof s.remote[field])).join(' ') + ' fields:' + Object.keys(s.remote ?? {}).sort().join(',');
  const unshownShapes = {};
  for (const s of unshown) unshownShapes[shape(s)] = (unshownShapes[shape(s)] ?? 0) + 1;
  const summary = { walkedAt: new Date(started).toISOString(), walkMs: Date.now() - started, statuses, failures: lines, ...catalogSummary(network, items, store.exchanges, new Map(statuses.map((s) => [s.key, s.dropped]))), unshownClaudeCodeRemoteServers: { count: unshown.length, shapes: unshownShapes } };
  const text = JSON.stringify(summary, null, 2);
  if (process.env.CATALOG_SUMMARY_OUT) writeFileSync(process.env.CATALOG_SUMMARY_OUT, text + '\\n');
  console.log(text);
} finally {
  rmSync(cache, { recursive: true, force: true });
}
`;

const work = mkdtempSync(join(tmpdir(), 'maws-catalog-summary-build-'));
try {
  const bundle = join(work, 'summary.mjs');
  await build({ stdin: { contents: ENTRY, resolveDir: REPO, loader: 'ts', sourcefile: 'catalog-summary-entry.ts' }, bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: bundle, alias: { '@shared': join(REPO, 'src/shared') }, logLevel: 'warning' });
  const run = spawnSync(process.execPath, [bundle], { stdio: 'inherit', env: { ...process.env, MAWS_E2E: '', CATALOG_SUMMARY_UA: `MAWS/${version} (catalog summary; https://github.com/SSFSKIM/MAWS)`, ...(out ? { CATALOG_SUMMARY_OUT: out } : {}) } });
  process.exitCode = run.status ?? 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
