import console from 'node:console';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import { planOf } from '../.github/scripts/gate-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;

test('only a direct hosted e2e entry grants a retry, not the mirror, mini, guest, pool or excluded groups', () => {
  const base = { GATE_E2E_RUNNER: 'macos', HOSTED_MAC_ROUTE: 'direct', HOSTED_MAC_E2E: 'design-systems desk-web-hub', MAC_VM_E2E: 'design-systems', POOL_E2E: 'desk-web', LINUX_E2E: 'desk-web', MEASURED_E2E: 'design-scale', MAC_SECRET_E2E: 'connectors-oauth', LIVE_E2E: 'design-live' };
  const entries = (env, gates, trailers = '') => JSON.parse(planOf({ ...base, ...env, HEAD_MESSAGE: `Gates: ${gates}\n${trailers}` }, scripts).outputs.e2e);
  const retries = (rows) => rows.filter((row) => row.retry).map((row) => row.group);
  assert.deepEqual(retries(entries({}, 'e2e:design-systems,e2e:desk-web-hub,e2e:desk-web')), ['design-systems', 'desk-web-hub']);
  for (const [env, trailer] of [[{ HOSTED_MAC_ROUTE: 'mirror' }, ''], [{}, 'Lane: no-hosted'], [{}, 'Lane: vm']]) {
    assert.deepEqual(retries(entries(env, 'e2e:design-systems', trailer)), []);
  }
  assert.deepEqual(retries(entries({ GATE_RUNNER: 'pool' }, 'e2e:desk-web,e2e:design-scale,e2e:connectors-oauth', 'Lane: hosted')), []);
  assert.deepEqual(retries(entries({}, 'e2e:design-live', 'Live: yes\nLane: hosted')), []);
  assert.deepEqual(retries(entries({}, 'packaged,static,unit,probes')), []);
});

test('the reporter publishes only flaky outcomes, as a location in the job summary and a GitHub annotation', async () => {
  const { default: Reporter } = await import('./ci-flaky-reporter.mjs');
  const reporter = new Reporter();
  reporter.onBegin({}, { allTests: () => ['expected', 'unexpected', 'skipped', 'flaky', 'flaky'].map((outcome) => ({
    outcome: () => outcome, location: { file: `${root}e2e/example.spec.ts`, line: 19 },
  })) });
  const lines = [];
  const original = console.log;
  try {
    console.log = (line) => lines.push(line);
    reporter.onEnd();
  } finally { console.log = original; }
  assert.deepEqual(lines, ['flaky: e2e/example.spec.ts:19', '::warning title=MAWS flaky,file=e2e/example.spec.ts,line=19::flaky: e2e/example.spec.ts:19']);
  const dir = mkdtempSync(join(tmpdir(), 'ci-flaky-summary-'));
  try {
    const summary = join(dir, 'summary');
    execFileSync('bash', [join(root, '.github/scripts/gate-run.sh'), '^flaky:', 'printf', '%s\n', ...lines], { env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });
    assert.match(readFileSync(summary, 'utf8'), /\nflaky: e2e\/example.spec.ts:19\n/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the tail reader keeps flaky annotations from earlier attempts and ignores ordinary failures and non-e2e jobs', async () => {
  const { flakyLines } = await import('./ci-gate-flaky.mjs');
  const calls = [];
  const gh = (endpoint) => {
    calls.push(endpoint);
    if (endpoint.includes('/jobs?')) return [{ jobs: [{ id: 1, name: 'e2e:design-systems' }, { id: 2, name: 'static' }] }, { jobs: [{ id: 3, name: 'e2e:desk-web-hub' }, { id: 4, name: 'e2e:design-systems' }] }];
    if (endpoint.includes('/1/')) return [[{ title: 'MAWS flaky', message: 'flaky: e2e/example.spec.ts:19' }, { title: '', message: 'Process completed with exit code 1.' }]];
    if (endpoint.includes('/3/')) return [[{ title: 'MAWS flaky', message: 'flaky: apps/desk-web/e2e-hub/cards.spec.ts:40' }]];
    if (endpoint.includes('/4/')) return [[{ title: 'MAWS flaky', message: 'flaky: e2e/example.spec.ts:19' }]];
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
  assert.deepEqual(flakyLines('SSFSKIM/MAWS', '123', gh), ['flaky: e2e/example.spec.ts:19', 'flaky: apps/desk-web/e2e-hub/cards.spec.ts:40']);
  assert.match(calls[0], /filter=all/);
  assert.equal(calls.length, 4);
  assert.throws(() => flakyLines('SSFSKIM/MAWS', '123', () => { throw new Error('unreadable'); }), /unreadable/);
});
