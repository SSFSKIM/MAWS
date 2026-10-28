import console from 'node:console';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

// The reader sees real job fields, including skipped matrix placeholders and jobs cancelled before a runner took them.
const job = (id, name, extra = {}) => ({ id, name, status: 'completed', conclusion: 'success', runner_name: 'GitHub Actions 1', ...extra });

test('more than ten flaky locations survive one dedicated-step annotation and still appear individually in the summary', async () => {
  const { default: Reporter } = await import('./ci-flaky-reporter.mjs');
  const { flakyReport } = await import('./ci-gate-flaky.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ci-flaky-summary-'));
  const savedFile = process.env.MAWS_E2E_FLAKY_FILE;
  const original = console.log;
  const lines = [];
  const expected = Array.from({ length: 20 }, (_, i) => `flaky: e2e/example.spec.ts:${i + 1}`);
  try {
    const file = join(dir, 'flaky');
    process.env.MAWS_E2E_FLAKY_FILE = file;
    const reporter = new Reporter();
    reporter.onBegin({}, { allTests: () => [...Array.from({ length: 20 }, (_, i) => ['flaky', i + 1]), ['flaky', 1], ['expected', 21], ['unexpected', 22], ['skipped', 23]].map(([outcome, line]) => ({
      outcome: () => outcome, location: { file: `${root}e2e/example.spec.ts`, line },
    })) });
    console.log = (line) => lines.push(line);
    reporter.onEnd();
    console.log = original;
    assert.deepEqual(lines, expected, 'the test step writes no annotations that other warnings could crowd out');
    assert.equal(readFileSync(file, 'utf8'), `${expected.join('\n')}\n`);
    const published = execFileSync(process.execPath, [join(root, 'scripts/ci-flaky-reporter.mjs'), file], { encoding: 'utf8' }).trim();
    assert.equal(published, `::notice title=MAWS flaky::${expected.join('%0A')}`);
    // Actions decodes the workflow command before storing the annotation message.
    const message = published.split('::').at(-1).replaceAll('%0D', '\r').replaceAll('%0A', '\n').replaceAll('%25', '%');
    const report = flakyReport('SSFSKIM/MAWS', '123', (endpoint) => endpoint.includes('/jobs?')
      ? [{ jobs: [job(1, 'e2e:design-systems')] }]
      : [[{ title: 'MAWS flaky', message }]]);
    assert.deepEqual(report, { lines: expected, unreadable: [] });
    const summary = join(dir, 'summary');
    execFileSync('bash', [join(root, '.github/scripts/gate-run.sh'), '^flaky:', 'printf', '%s\n', ...lines], { env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });
    assert.ok(readFileSync(summary, 'utf8').includes(`${expected.join('\n')}\n`));
    assert.equal(execFileSync(process.execPath, [join(root, 'scripts/ci-flaky-reporter.mjs'), join(dir, 'missing')], { encoding: 'utf8' }), '');
  } finally {
    console.log = original;
    if (savedFile === undefined) delete process.env.MAWS_E2E_FLAKY_FILE;
    else process.env.MAWS_E2E_FLAKY_FILE = savedFile;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the tail reader skips jobs that never ran and preserves other jobs and attempts when one annotations read fails', async () => {
  const { flakyReport } = await import('./ci-gate-flaky.mjs');
  const calls = [];
  const gh = (endpoint) => {
    calls.push(endpoint);
    if (endpoint.includes('/jobs?')) return [{ jobs: [job(1, 'e2e:design-systems'), job(2, 'static'), job(5, 'e2e:${{ matrix.group }}', { conclusion: 'skipped', runner_name: null })] }, { jobs: [job(3, 'e2e:desk-web-hub'), job(4, 'e2e:design-systems'), job(6, 'e2e:never-started', { conclusion: 'cancelled', runner_name: '' })] }];
    if (endpoint.includes('/1/')) return [[{ title: 'MAWS flaky', message: 'flaky: e2e/example.spec.ts:19' }, { title: '', message: 'Process completed with exit code 1.' }]];
    if (endpoint.includes('/3/')) throw new Error('502');
    if (endpoint.includes('/4/')) return [[{ title: 'MAWS flaky', message: 'flaky: e2e/example.spec.ts:19\nflaky: e2e/other.spec.ts:20' }]];
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
  assert.deepEqual(flakyReport('SSFSKIM/MAWS', '123', gh), { lines: ['flaky: e2e/example.spec.ts:19', 'flaky: e2e/other.spec.ts:20'], unreadable: ['e2e:desk-web-hub'] });
  assert.match(calls[0], /filter=all/);
  assert.equal(calls.length, 4);
  assert.throws(() => flakyReport('SSFSKIM/MAWS', '123', () => { throw new Error('unreadable'); }), /unreadable/);
});

test('a stalled gh read is bounded, warns by job name, and prints the other jobs instead of holding the verdict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-flaky-timeout-'));
  try {
    const node = join(dir, "node's executable");
    symlinkSync(process.execPath, node);
    const jobs = JSON.stringify([{ jobs: [job(1, 'e2e:stalled'), job(2, 'e2e:readable')] }]);
    const notes = JSON.stringify([[{ title: 'MAWS flaky', message: 'flaky: e2e/kept.spec.ts:8' }]]);
    writeFileSync(join(dir, 'gh'), `#!/bin/sh\ncase "$*" in\n  *'/jobs?'*) printf '%s' '${jobs}' ;;\n  *'/1/'*) exec "$NODE" -e 'setInterval(() => {}, 1000)' ;;\n  *) printf '%s' '${notes}' ;;\nesac\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const run = spawnSync(process.execPath, [join(root, 'scripts/ci-gate-flaky.mjs'), 'SSFSKIM/MAWS', '123'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, NODE: node }, timeout: 20_000,
    });
    assert.equal(run.signal, null, 'the reader must finish before its caller gives up');
    assert.equal(run.status, 0);
    assert.equal(run.stdout, 'flaky: e2e/kept.spec.ts:8\n');
    assert.match(run.stderr, /ci-gate: warning: could not read flaky tests for jobs: e2e:stalled/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
