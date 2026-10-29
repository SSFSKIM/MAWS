import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sampleBacklog, cachedBacklog } from './ci-gate-backlog.mjs';

const now = Date.parse('2026-10-29T02:00:00Z');
const labels = ['self-hosted', 'macOS', 'ARM64', 'ci-kit-mac', 'ci-kit-mac-solo', 'ci-kit-mac-ec2'];
const runner = { id: 6951, name: 'ci-kit-mac-ec2', status: 'online', busy: false, labels: labels.map((name) => ({ name })) };
const job = (id, labels, status = 'queued') => ({ id, labels, status, conclusion: null, runner_name: '' });
function apiFixture({ jobs = {}, runs = {}, runnerOverride = {} } = {}) {
  const calls = [];
  return { calls, api: (path) => {
    calls.push(path);
    if (path.includes('/runners?')) return { total_count: 1, runners: [{ ...runner, ...runnerOverride }] };
    const repo = path.split('/')[2];
    if (path.includes('/jobs?')) return { total_count: (jobs[repo] || []).length, jobs: jobs[repo] || [] };
    return { total_count: (runs[repo] || []).length, workflow_runs: path.includes('status=in_progress') ? runs[repo] || [] : [] };
  } };
}
test('counts account-wide hosted jobs but only jobs the MAWS EC2 runner can take in its own queue', async () => {
  const { api, calls } = apiFixture({
    runs: { MAWS: [{ id: 1 }], cua: [{ id: 2 }], doperpowers: [{ id: 3 }], 'ci-kit': [{ id: 4 }], 'manim-master': [{ id: 5 }] },
    jobs: { MAWS: [job(1, ['macos-26']), job(2, ['macos-26'], 'in_progress'), job(3, ['self-hosted', 'macOS', 'ARM64']), job(4, ['ci-kit-mac-solo']), job(5, ['ci-kit-mac-home']), job(6, ['ci-kit-mac-shared']), job(7, ['ubuntu-24.04']), job(8, ['macos-26'], 'completed')],
      cua: [job(9, ['macos-14'])], doperpowers: [job(10, ['macos-latest'])], 'ci-kit': [job(11, ['macos-26'])], 'manim-master': [job(12, ['macos-26'])] },
  });
  assert.deepEqual(await sampleBacklog({ api, now: () => now }), { v: 1, at: new Date(now).toISOString(), hostedQueued: 5, hostedRunning: 1, ec2: 'idle', ec2Queued: 2, partial: [] });
  assert.equal(calls.length, 16);
});
test('a failed or malformed read never supplies a partial success', async () => {
  for (const api of [() => { throw new Error('403'); }, () => ({}), apiFixture({ runnerOverride: { labels: [] } }).api]) {
    await assert.rejects(sampleBacklog({ api, now: () => now }));
  }
});
test('pagination completes the self queue; a cap there fails open rather than undercounting EC2 work', async () => {
  let calls = 0;
  const api = (path) => {
    calls++;
    if (path.includes('/runners?')) return { total_count: 1, runners: [runner] };
    if (path.includes('/jobs?')) return { total_count: 101, jobs: Array.from({ length: path.includes('page=2') ? 1 : 100 }, (_, i) => job(i, ['ci-kit-mac-solo'])) };
    return { total_count: path.includes('status=in_progress') ? 1 : 0, workflow_runs: path.includes('status=in_progress') ? [{ id: 1 }] : [] };
  };
  await assert.rejects(sampleBacklog({ api, now: () => now, maxCalls: 4 }), /cap|incomplete/);
  assert.equal(calls, 4);
});
test('the call cap truncates only hosted counts after MAWS, and discloses the lower bound', async () => {
  const { api, calls } = apiFixture({ runs: { MAWS: [{ id: 1 }], cua: [{ id: 2 }] }, jobs: { MAWS: [job(1, ['macos-26'])], cua: [job(2, ['macos-26'])] } });
  const result = await sampleBacklog({ api, now: () => now, maxCalls: 4 });
  assert.equal(calls.length, 4);
  assert.equal(result.hostedQueued, 1);
  assert.equal(result.ec2Queued, 0);
  assert.deepEqual(result.partial, ['SSFSKIM/cua', 'SSFSKIM/doperpowers', 'SSFSKIM/ci-kit', 'SSFSKIM/manim-master']);
});
test('busy and offline runner states survive the sample, and unknown states fail', async () => {
  for (const [override, expected] of [[{ busy: true }, 'busy'], [{ status: 'offline' }, 'offline']]) {
    assert.equal((await sampleBacklog({ api: apiFixture({ runnerOverride: override }).api, now: () => now })).ec2, expected);
  }
  await assert.rejects(sampleBacklog({ api: apiFixture({ runnerOverride: { status: 'unknown' } }).api, now: () => now }));
});
test('60-second atomic cache shares success and failures, expires, and does not duplicate an in-flight count', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-backlog-'));
  const cache = join(dir, 'sample.json');
  let clock = now;
  let calls = 0;
  let release;
  const sample = { v: 1, at: new Date(now).toISOString(), hostedQueued: 5, hostedRunning: 5, ec2: 'idle', ec2Queued: 0, partial: [] };
  const collect = async () => { calls++; return sample; };
  try {
    assert.deepEqual(await cachedBacklog({ cache, collect, now: () => clock }), sample);
    assert.deepEqual(await cachedBacklog({ cache, collect, now: () => clock }), sample);
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(readFileSync(cache, 'utf8')).sample, sample);
    clock += 61_000;
    const pending = cachedBacklog({ cache, now: () => clock, collect: async () => { calls++; await new Promise((r) => { release = r; }); return { ...sample, at: new Date(clock).toISOString() }; } });
    assert.equal(await cachedBacklog({ cache, collect, now: () => clock }), null);
    release();
    await pending;
    assert.equal(calls, 2);
    clock += 61_000;
    assert.equal(await cachedBacklog({ cache, now: () => clock, collect: async () => { calls++; throw new Error('timeout'); } }), null);
    assert.equal(await cachedBacklog({ cache, collect, now: () => clock }), null);
    assert.equal(calls, 3);
    clock += 61_000;
    writeFileSync(cache, 'corrupt');
    assert.deepEqual(await cachedBacklog({ cache, collect: async () => ({ ...sample, at: new Date(clock).toISOString() }), now: () => clock }), { ...sample, at: new Date(clock).toISOString() });
    // A crashed sampler cannot prevent recovery forever.
    mkdirSync(`${cache}.lock`);
    writeFileSync(`${cache}.lock/at`, String(clock - 120_000));
    clock += 61_000;
    assert.deepEqual(await cachedBacklog({ cache, collect: async () => ({ ...sample, at: new Date(clock).toISOString() }), now: () => clock }), { ...sample, at: new Date(clock).toISOString() });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
