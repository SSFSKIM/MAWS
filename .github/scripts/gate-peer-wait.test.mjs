import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { waitForPeer } from './gate-peer-wait.mjs';

const job = (name, status, conclusion = null) => ({ name, status, conclusion });
const plan = job('plan', 'completed', 'success');
const snapshot = (status = 'in_progress', conclusion = null, jobs = [plan, job('e2e:cross-build', 'queued')]) => ({ run: { status, conclusion }, jobs });
const done = (conclusion) => snapshot('completed', conclusion, [plan, job('e2e:cross-build', 'completed', conclusion)]);

async function wait(snapshots, options = {}) {
  let clock = 0;
  let poll = 0;
  const lines = [];
  const paths = [];
  const pauses = [];
  const status = await waitForPeer({
    repo: 'owner/repo', run: '90', group: 'cross-build', timeoutMs: 360_000,
    now: () => clock, sleep: async (ms) => { pauses.push(ms); clock += ms; poll++; }, log: (line) => lines.push(line),
    api: async (path) => {
      paths.push(path);
      const state = snapshots[Math.min(poll, snapshots.length - 1)];
      if (state instanceof Error) throw state;
      return path.includes('/jobs?') ? { jobs: state.jobs } : state.run;
    }, ...options,
  });
  return { status, lines, paths, poll, pauses };
}

test('the stand-in waits through the holder plan and peer job, then passes only with the peer success', async () => {
  const result = await wait([
    snapshot('in_progress', null, [job('plan', 'in_progress')]),
    snapshot(),
    snapshot('in_progress', null, [plan, job('e2e:cross-build', 'in_progress')]),
    done('success'),
  ], { timeoutMs: 480_000 });
  assert.equal(result.status, 0);
  assert.equal(result.poll, 3);
  assert.equal(result.lines.at(-1), 'held by run 90: success');
  assert.match(result.paths[0], /\/repos\/owner\/repo\/actions\/runs\/90$/);
  assert.match(result.paths[1], /\/jobs\?filter=latest&per_page=100&page=1$/);
});

for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'action_required']) {
  test(`a ${conclusion} peer check fails the stand-in with a recovery instruction`, async () => {
    const { status, lines } = await wait([done(conclusion)]);
    assert.equal(status, 1);
    assert.match(lines.at(-1), new RegExp(`held by run 90:.*${conclusion}`));
    assert.match(lines.at(-1), /--gates e2e:cross-build.*rerun 90/);
  });
}

test('a failed or cancelled plan, or a completed holder without a peer job, fails the stand-in', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped']) {
    const { status, lines } = await wait([snapshot('in_progress', null, [job('plan', 'completed', conclusion)])]);
    assert.equal(status, 1);
    assert.match(lines.at(-1), /held by run 90:.*plan/);
  }
  const { status, lines } = await wait([snapshot('completed', 'success', [plan])]);
  assert.equal(status, 1);
  assert.match(lines.at(-1), /held by run 90:.*without.*e2e:cross-build/);
});

test('a successful plan can precede publication of the peer job while the holder is still active', async () => {
  const { status, lines, poll } = await wait([snapshot('in_progress', null, [plan]), done('success')]);
  assert.equal(status, 0);
  assert.equal(poll, 1);
  assert.equal(lines.at(-1), 'held by run 90: success');
});

test('a cancelled holder with a stale queued peer job cannot pass or keep waiting', async () => {
  const { status, lines, poll } = await wait([snapshot('completed', 'cancelled')]);
  assert.equal(status, 1);
  assert.equal(poll, 0);
  assert.match(lines.at(-1), /holder.*cancelled/);
});

test('a successful peer check is sufficient even if an unrelated holder job failed', async () => {
  const { status } = await wait([snapshot('completed', 'failure', [plan, job('e2e:cross-build', 'completed', 'success')])]);
  assert.equal(status, 0);
});

test('API and parse errors retry three times then fail, never pass', async () => {
  for (const state of [new Error('HTTP 403'), { run: { status: 'completed' }, jobs: [] }, { run: { status: 'in_progress', conclusion: null }, jobs: null }]) {
    const { status, lines, poll } = await wait([state]);
    assert.equal(status, 1);
    assert.equal(poll, 2);
    assert.equal(lines.filter((line) => /API attempt \d/.test(line)).length, 3);
    assert.match(lines.at(-1), /could not read.*--gates e2e:cross-build.*rerun 90/);
  }
});

test('a transient API failure can recover, but queued work cannot pass at the deadline', async () => {
  assert.equal((await wait([new Error('HTTP 503'), done('success')])).status, 0);
  const { status, lines } = await wait([snapshot()]);
  assert.equal(status, 1);
  assert.match(lines.at(-1), /timed out; holder was still unfinished.*--gates e2e:cross-build/);
});

test('rerunning the stand-in re-reads the latest holder attempt rather than preserving the old failure', async () => {
  assert.equal((await wait([done('failure')])).status, 1);
  const { status, paths } = await wait([snapshot('in_progress', null, [job('e2e:cross-build', 'in_progress')]), done('success')]);
  assert.equal(status, 0);
  assert.ok(paths.filter((path) => path.includes('/jobs?')).every((path) => path.includes('filter=latest')));
});

test('the workflow entry point exits with the holder verdict, not just a log line', async () => {
  let conclusion = 'success';
  const server = createServer((request, response) => {
    const state = done(conclusion);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url.includes('/jobs?') ? { jobs: state.jobs } : state.run));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const execute = () => promisify(execFile)(process.execPath, [fileURLToPath(new URL('./gate-peer-wait.mjs', import.meta.url))], {
      env: { ...process.env, GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'test-token', GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, PEER_RUN: '90', PEER_GROUP: 'cross-build', PEER_WAIT_MINUTES: '1' },
    });
    assert.equal((await execute()).stdout, 'held by run 90: success\n');
    conclusion = 'failure';
    await assert.rejects(execute(), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /held by run 90: failure.*--gates e2e:cross-build.*rerun 90/);
      return true;
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('normal polling fits a sibling batch within the repository API quota; errors retry sooner', async () => {
  const pending = await wait([snapshot(), snapshot(), done('success')]);
  assert.equal(pending.status, 0);
  assert.deepEqual(pending.pauses, [120_000, 120_000]);
  const retry = await wait([new Error('HTTP 503'), done('success')]);
  assert.equal(retry.status, 0);
  assert.deepEqual(retry.pauses, [30_000]);
});
