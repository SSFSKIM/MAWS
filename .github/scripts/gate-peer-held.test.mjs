import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { peerHeldBy } from './gate-peer-held.mjs';

const peer = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const message = (gates = 'unit', extra = '') => `Gates: ${gates}\nPeer: ${peer}\nPeer-Wire: 3.0\nWire: 3.1\n${extra}`;
const scripts = { 'e2e:cross-build': 'test', 'e2e:library-live': 'test' };
const env = { EVENT: 'push', GITHUB_RUN_ID: '100', GITHUB_REPOSITORY: 'owner/repo', PEER_E2E: 'cross-build', LIVE_E2E: 'library-live' };
const event = { head_commit: { tree_id: tree, message: message() } };
const run = (id = 90, changes = {}) => ({ id, event: 'push', head_branch: `ci/test-${id}`, head_commit: { tree_id: tree, message: message() }, ...changes });
const job = (name, status, conclusion = null) => ({ name, status, conclusion });
const queued = [job('plan', 'completed', 'success'), job('e2e:cross-build', 'queued')];

async function check({ runs = [run()], jobs = queued, ...options } = {}) {
  const paths = [];
  const warnings = [];
  const result = await peerHeldBy({
    env, scripts, event, now: new Date('2026-10-28T04:00:00Z'),
    api: async (path) => {
      paths.push(path);
      if (path.includes('/workflows/')) return { workflow_runs: runs };
      return { jobs: typeof jobs === 'function' ? jobs(path) : jobs };
    },
    warn: (warning) => warnings.push(warning), ...options,
  });
  return { result, paths, warnings };
}

test('the lowest lower run id wins, independent of API order and equal creation times', async () => {
  const { result, paths } = await check({ runs: [run(110), run(95), run(80), run(100)] });
  assert.equal(result, '80 queued');
  assert.equal(paths.length, 2);
  assert.match(paths[0], /\/actions\/workflows\/gate.yml\/runs\?/);
  const query = new URL(`https://api.github.com${paths[0]}`).searchParams;
  assert.equal(query.get('event'), 'push');
  assert.equal(query.get('created'), '>=2026-10-27T04:00:00.000Z');
  assert.equal(query.get('per_page'), '100');
});

test('another tree, another peer, the current run and higher ids cannot hold the check', async () => {
  for (const candidate of [run(100), run(101), run(90, { head_commit: { ...event.head_commit, tree_id: 'c'.repeat(40) } }), run(90, { head_commit: { tree_id: tree, message: message().replace(peer, 'd'.repeat(40)) } })]) {
    const { result, paths } = await check({ runs: [candidate] });
    assert.equal(result, '');
    assert.equal(paths.length, 1);
  }
});

for (const [status, conclusion, held] of [
  ['queued', null, 'queued'], ['in_progress', null, 'in_progress'], ['waiting', null, 'waiting'],
  ['completed', 'success', 'succeeded'], ['completed', 'failure', ''], ['completed', 'cancelled', ''],
  ['completed', 'skipped', ''], ['completed', 'timed_out', ''], ['completed', 'neutral', ''],
]) {
  test(`a peer job ${status}/${conclusion} ${held ? 'holds' : 'does not hold'} the check`, async () => {
    const { result } = await check({ jobs: [job('plan', 'completed', 'success'), job('e2e:cross-build', status, conclusion)] });
    assert.equal(result, held ? `90 ${held}` : '');
  });
}

test('a plan not finished holds the check before the peer job exists; a finished plan without it does not', async () => {
  for (const status of ['queued', 'in_progress', 'waiting', 'completed']) {
    const { result } = await check({ jobs: [job('plan', status, status === 'completed' ? 'success' : null)] });
    assert.equal(result, status === 'completed' ? '' : `90 plan ${status}`);
  }
  assert.equal((await check({ jobs: [] })).result, '');
});

test('a failed peer job cannot be hidden by an unfinished plan or prevent a later holder', async () => {
  const { result } = await check({ runs: [run(80), run(90)], jobs: (path) => path.includes('/80/') ? [job('plan', 'in_progress'), job('e2e:cross-build', 'completed', 'failure')] : queued });
  assert.equal(result, '90 queued');
});

test('static-only, live and affected candidates do not hold a peer check', async () => {
  for (const text of [message('static'), message('e2e:library-live', 'Live: yes'), message('unit', 'Selection: affected\nAffected-Count: 0')]) {
    const { result, paths } = await check({ runs: [run(90, { head_commit: { tree_id: tree, message: text } })] });
    assert.equal(result, '');
    assert.equal(paths.length, 1);
  }
});

test('an explicitly named peer group is a holder too', async () => {
  assert.equal((await check({ runs: [run(90, { head_commit: { tree_id: tree, message: message('e2e:cross-build') } })] })).result, '90 queued');
});

test('dispatches, absent peers and matching minors do not consult the API', async () => {
  for (const options of [{ env: { ...env, EVENT: 'workflow_dispatch' } }, { event: { head_commit: { tree_id: tree, message: 'Gates: unit' } } }, { event: { head_commit: { tree_id: tree, message: message().replace('Wire: 3.1', 'Wire: 3.0') } } }]) {
    const { result, paths } = await check(options);
    assert.equal(result, '');
    assert.equal(paths.length, 0);
  }
});

test('API and malformed response failures fail open with a warning', async () => {
  for (const api of [async () => { throw new Error('HTTP 403'); }, async () => ({ workflow_runs: null }), async () => ({ workflow_runs: [run(90, { head_commit: null })] }), async (path) => path.includes('/workflows/') ? { workflow_runs: [run()] } : { jobs: [job('plan', 'completed', 'success'), { name: 'e2e:cross-build' }] }]) {
    const { result, warnings } = await check({ api });
    assert.equal(result, '');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /warning.*peer.*join/i);
  }
  const { result, warnings } = await check({ event: { head_commit: { tree_id: tree, message: message().replace('3.1', 'bad') } } });
  assert.equal(result, '');
  assert.equal(warnings.length, 1);
});

test('searches at most two run pages and can find a holder on the second', async () => {
  const paths = [];
  const { result } = await check({ api: async (path) => {
    paths.push(path);
    if (path.includes('/jobs?')) return { jobs: queued };
    return { workflow_runs: new URL(`https://api.github.com${path}`).searchParams.get('page') === '1' ? Array.from({ length: 100 }, (_, i) => run(200 + i)) : [run()] };
  } });
  assert.equal(result, '90 queued');
  assert.equal(paths.length, 3);
});

test('all peer groups must be held before the plan can omit them', async () => {
  const options = { env: { ...env, PEER_E2E: 'cross-build second' }, scripts: { ...scripts, 'e2e:second': 'test' } };
  assert.equal((await check(options)).result, '');
  assert.equal((await check({ ...options, jobs: [...queued, job('e2e:second', 'completed', 'success')] })).result, '90 queued');
});

test('the workflow entry point authenticates the API request and writes only a validated hold to GITHUB_ENV', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'peer-held-'));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const requests = [];
  let mode = 'success';
  const server = createServer((request, response) => {
    requests.push({ path: request.url, token: request.headers.authorization });
    response.setHeader('Content-Type', 'application/json');
    if (mode === 'http') response.writeHead(403);
    response.end(mode === 'json' ? 'not JSON' : JSON.stringify(request.url.includes('/workflows/') ? { workflow_runs: [run()] } : { jobs: queued }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const eventPath = join(dir, 'event.json');
    const envPath = join(dir, 'env');
    writeFileSync(eventPath, JSON.stringify(event));
    for (mode of ['success', 'http', 'json', 'event']) {
      writeFileSync(envPath, '');
      if (mode === 'event') writeFileSync(eventPath, 'bad event JSON');
      const { stdout, stderr } = await promisify(execFile)(process.execPath, ['.github/scripts/gate-peer-held.mjs'], {
        cwd: root,
        env: { ...process.env, ...env, GATE_RUNNER: '', GATE_E2E_RUNNER: '', GITHUB_EVENT_PATH: eventPath, GITHUB_ENV: envPath, GITHUB_TOKEN: 'test-token', GITHUB_API_URL: `http://127.0.0.1:${server.address().port}` },
      });
      assert.equal(readFileSync(envPath, 'utf8'), mode === 'success' ? 'PEER_HELD_BY=90 queued\n' : 'PEER_HELD_BY=\n');
      assert.equal(stdout, '');
      if (mode === 'success') assert.equal(stderr, '');
      else assert.match(stderr, /warning:.*peer groups will join normally/);
    }
    assert.equal(requests[0].token, 'Bearer test-token');
    assert.match(requests[1].path, /\/runs\/90\/jobs\?filter=latest/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
