import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    return { total_count: path.includes('status=in_progress') ? (runs[repo] || []).length : 0, workflow_runs: path.includes('status=in_progress') ? runs[repo] || [] : [] };
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

test('a cap exhausted by the runner read cannot return an uncounted MAWS queue', async () => {
  const { api, calls } = apiFixture();
  await assert.rejects(sampleBacklog({ api, now: () => now, maxCalls: 1 }), /cap|incomplete/);
  assert.equal(calls.length, 1);
});
test('pagination counts all compatible jobs and deduplicates a run seen across status transitions', async () => {
  const calls = [];
  const result = await sampleBacklog({ now: () => now, api: (path) => {
    calls.push(path);
    if (path.includes('/runners?')) return { total_count: 1, runners: [runner] };
    if (!path.includes('/MAWS/')) return { total_count: 0, workflow_runs: [] };
    if (path.includes('/jobs?')) return { total_count: 101, jobs: path.includes('page=2') ? [job(101, ['ci-kit-mac-solo'])] : Array.from({ length: 100 }, (_, i) => job(i + 1, ['SELF-HOSTED', 'MACOS', 'arm64'])) };
    return { total_count: 1, workflow_runs: [{ id: 1 }] };
  } });
  assert.equal(result.ec2Queued, 101);
  assert.equal(calls.filter((path) => path.includes('/jobs?')).length, 2);
});
test('the overall deadline stops reads even before the call cap', async () => {
  let clock = now;
  const { api, calls } = apiFixture();
  await assert.rejects(sampleBacklog({ now: () => clock, budgetMs: 100, api: (path, timeout) => {
    assert.ok(timeout <= 100);
    clock += 101;
    return api(path);
  } }), /timeout/);
  assert.equal(calls.length, 1);
});

test('every MAWS page, including a short final page, must match the count before overflow can be advised', async () => {
  for (const endpoint of ['/runners?', '/runs?status=queued', '/runs?status=in_progress', '/jobs?']) {
    const fixture = apiFixture({ runs: { MAWS: [{ id: 1 }] } });
    await assert.rejects(sampleBacklog({ now: () => now, api: (path) => {
      const data = fixture.api(path);
      if (path.includes('/MAWS/') && path.includes(endpoint)) return { ...data, total_count: 4 };
      return data;
    } }), /incomplete/, endpoint);
  }
  // The second jobs page is the final one, but still owes the one remaining row.
  await assert.rejects(sampleBacklog({ now: () => now, api: (path) => {
    if (path.includes('/runners?')) return { total_count: 1, runners: [runner] };
    if (path.includes('/jobs?')) return { total_count: 101, jobs: path.includes('page=2') ? [] : Array.from({ length: 100 }, (_, i) => job(i + 1, ['ci-kit-mac-solo'])) };
    return { total_count: 1, workflow_runs: [{ id: 1 }] };
  } }), /incomplete/);
});

test('the destination repo owns the runner read, completeness guard and EC2 queue', async () => {
  const fixture = apiFixture({ runs: { MAWS: [{ id: 1 }] }, jobs: { MAWS: [job(1, ['ci-kit-mac-solo']), job(2, ['macos-26'])] } });
  const env = { REPO: 'neworg/MAWS', HOSTED_MAC_REPOS: 'neworg/MAWS' };
  const result = await sampleBacklog({ ...fixture, now: () => now, env });
  assert.equal(result.ec2Queued, 1);
  assert.equal(result.hostedQueued, 1);
  assert.match(fixture.calls[0], /^repos\/neworg\/MAWS\/actions\/runners\?/);
  assert.ok(fixture.calls.every((path) => path.startsWith('repos/neworg/MAWS/')));
  for (const endpoint of ['/runners?', '/runs?status=queued', '/runs?status=in_progress', '/jobs?']) {
    await assert.rejects(sampleBacklog({ env, now: () => now, api: (path) => {
      const data = fixture.api(path);
      return path.includes(endpoint) ? { ...data, total_count: 4 } : data;
    } }), /incomplete/, endpoint);
  }
});

test('MAWS is counted first and in full even when omitted or repeated in the quota list', async () => {
  for (const list of ['neworg/other', 'neworg/other, neworg/MAWS neworg/MAWS']) {
    const fixture = apiFixture({ runs: { MAWS: [{ id: 1 }] }, jobs: { MAWS: [job(1, ['ci-kit-mac-solo'])] } });
    const result = await sampleBacklog({ ...fixture, now: () => now, maxCalls: 4, env: { REPO: 'neworg/MAWS', HOSTED_MAC_REPOS: list } });
    assert.equal(result.ec2Queued, 1);
    assert.deepEqual(result.partial, ['neworg/other']);
    await assert.rejects(sampleBacklog({ ...fixture, maxCalls: 1, env: { REPO: 'neworg/MAWS', HOSTED_MAC_REPOS: list } }), /cap/);
  }
});

test('malformed quota repositories are refused before any API read', async () => {
  for (const list of ['MAWS', 'https://github.com/neworg/MAWS', 'neworg/MAWS/extra', 'neworg/MAWS ../bad', ', ,']) {
    const fixture = apiFixture();
    await assert.rejects(sampleBacklog({ ...fixture, env: { REPO: 'neworg/MAWS', HOSTED_MAC_REPOS: list } }), /HOSTED_MAC_REPOS/);
    assert.deepEqual(fixture.calls, []);
  }
});

test('the CLI cache separates repo moves and quota-list changes while sharing identical calls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-backlog-config-'));
  try {
    writeFileSync(join(dir, 'gh'), `#!/bin/sh
printf '%s\\n' "$*" >> '${join(dir, 'calls')}'
case "$*" in
  *'/runners?'*) echo '${JSON.stringify({ total_count: 1, runners: [runner] })}' ;;
  *'/jobs?'*) echo '${JSON.stringify({ total_count: 1, jobs: [job(1, ['macos-26'])] })}' ;;
  *'status=queued'*) echo '{"total_count":1,"workflow_runs":[{"id":1}]}' ;;
  *) echo '{"total_count":0,"workflow_runs":[]}' ;;
esac
`);
    chmodSync(join(dir, 'gh'), 0o755);
    const sample = (repo, repos) => {
      const output = execFileSync(process.execPath, [fileURLToPath(new URL('./ci-gate-backlog.mjs', import.meta.url))], {
        encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, XDG_CACHE_HOME: dir, REPO: repo, HOSTED_MAC_REPOS: repos },
      });
      return JSON.parse(output.slice('Mac-Backlog: '.length));
    };
    assert.equal(sample('', '').hostedQueued, 5);
    assert.equal(sample('neworg/MAWS', 'neworg/MAWS').hostedQueued, 1);
    assert.equal(sample('neworg/MAWS', 'neworg/MAWS,neworg/other').hostedQueued, 2);
    const calls = readFileSync(join(dir, 'calls'), 'utf8');
    assert.equal(sample('neworg/MAWS', 'neworg/MAWS,neworg/other').hostedQueued, 2);
    assert.equal(readFileSync(join(dir, 'calls'), 'utf8'), calls);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
