// node --test scripts/ci-gate-pace.test.mjs (from anywhere; no install needed). ci-gate.sh's reads through an exhausted
// API budget, scripts/ci-gate-pace.sh, run in bash as ci-gate.sh runs it against a fake `gh` that answers a scenario's
// calls in order, on a fake clock that only `sleep` moves (`date +%s` reads it).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const start = 1794312000; // 2026-11-10T12:00:00Z

// gh's answers when the budget is spent, as gh 2.x prints them: `gh api` names the limit and the status, `gh run` reads
// prefix them with what they were fetching.
const exhausted = 'gh: API rate limit exceeded for user ID 1234567. If you reach out to GitHub Support for help, please include the request ID 0000:1111:2222 and timestamp 2026-11-10 11:05:00 UTC. For more on scraping GitHub and how it may affect your rights, please review our Terms of Service (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) (HTTP 403)';
const watchExhausted = 'failed to get run: HTTP 403: API rate limit exceeded for user ID 1234567. (https://api.github.com/repos/SSFSKIM/MAWS/actions/runs/123)';
const secondary = 'gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 429)';
const forbidden = 'gh: Resource not accessible by integration (HTTP 403)';
const serverError = 'gh: HTTP 502: Server Error (https://api.github.com/repos/SSFSKIM/MAWS/actions/runs/123)';

// answers: the call's answers in order, { stdout, stderr, status }, the last repeated. budget: GET /rate_limit's answers
// in order as [remaining, reset seconds from the clock's now], the last repeated, or null for a read that fails.
const fakeGh = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = path.dirname(process.argv[1]);
const scenario = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'gh-calls'), args.join(' ') + '\n');
const next = (key, list) => {
  const counter = path.join(dir, key);
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  fs.writeFileSync(counter, String(n + 1));
  return list[Math.min(n, list.length - 1)];
};
if (args[0] === 'api' && args[1] === 'rate_limit') {
  const core = next('budget-reads', scenario.budget);
  if (core === null) { process.stderr.write('gh: HTTP 502\n'); process.exit(1); }
  if (args[2] !== '--jq' || args[3] !== '"\\(.resources.core.remaining) \\(.resources.core.reset)"') { process.stderr.write('fake gh: unexpected --jq\n'); process.exit(1); }
  process.stdout.write(core[0] + ' ' + (Number(fs.readFileSync(path.join(dir, 'clock'), 'utf8')) + core[1]) + '\n');
  process.exit(0);
}
const answer = next('answers', scenario.answers);
if (answer.stdout) process.stdout.write(answer.stdout);
if (answer.stderr) process.stderr.write(answer.stderr + '\n');
process.exit(answer.status ?? 0);
`;

// Runs `calls` (each a paced_gh argument list) in one shell, as ci-gate.sh makes its reads, each in a command
// substitution of its own. Returns each call's status, stdout and stderr, the gh calls, the sleeps, and the mark.
function paced(scenario, calls = [['run', 'view', '123']], { limitWait, staleMark } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-pace-'));
  try {
    writeFileSync(join(dir, 'gh'), fakeGh);
    writeFileSync(join(dir, 'clock'), String(start));
    writeFileSync(join(dir, 'sleep'), `#!/bin/sh\necho "$1" >> '${join(dir, 'sleeps')}'\necho $(($(cat '${join(dir, 'clock')}') + $1)) > '${join(dir, 'clock')}'\n`);
    writeFileSync(join(dir, 'date'), `#!/bin/sh\nif [ "$*" = +%s ]; then cat '${join(dir, 'clock')}'; else exec /bin/date "$@"; fi\n`);
    for (const fake of ['gh', 'sleep', 'date']) chmodSync(join(dir, fake), 0o755);
    writeFileSync(join(dir, 'scenario.json'), JSON.stringify({ budget: [[0, 600]], ...scenario }));
    const script = [
      staleMark ? `echo ${staleMark} > "$TMPDIR/ci-gate-pace.$$"` : '',
      'set -uo pipefail; source "$0"',
      limitWait ? `LIMIT_WAIT=${limitWait}` : '',
      ...calls.map((call) => `out=$(paced_gh ${call.map((arg) => `'${arg}'`).join(' ')} 2>err); status=$?; printf '%s\\x1f%s\\x1f%s\\x1e' "$status" "$out" "$(cat err)"`),
      'printf "mark=%s" "$(cat "$PACE_MARK" 2>/dev/null)"',
    ].join('\n');
    const shell = spawnSync('bash', ['-c', script, join(root, 'scripts/ci-gate-pace.sh')], {
      encoding: 'utf8', cwd: dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TMPDIR: dir },
    });
    assert.equal(shell.stderr, '');
    const parts = shell.stdout.split('\x1e');
    const mark = parts.pop().replace(/^mark=/, '');
    const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8').trimEnd().split('\n') : []);
    return {
      results: parts.map((part) => { const [status, stdout, stderr] = part.split('\x1f'); return { status: Number(status), stdout, stderr }; }),
      calls: read('gh-calls'),
      sleeps: read('sleeps').map(Number),
      mark,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const waitLine = /^ci-gate: the GitHub API rate limit is reached \(remaining 0, resets \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\); waiting until \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

test('a read the budget refuses twice is waited out until the reset, then answers as gh did, with no stale output', () => {
  const result = paced({ answers: [{ stdout: 'partial page\n', stderr: exhausted, status: 1 }, { stderr: watchExhausted, status: 1 }, { stdout: 'in_progress\n' }], budget: [[0, 600], [4999, 3600], [0, 600], [4999, 3600]] });
  assert.deepEqual(result.results, [{ status: 0, stdout: 'in_progress', stderr: result.results[0].stderr }]);
  const lines = result.results[0].stderr.split('\n');
  assert.equal(lines.length, 2, result.results[0].stderr);
  for (const line of lines) assert.match(line, waitLine);
  assert.deepEqual(result.calls.filter((call) => call === 'run view 123').length, 3);
  // Each wait reads the budget before sleeping and again after waking.
  assert.equal(result.calls.filter((call) => call.startsWith('api rate_limit')).length, 4);
  assert.equal(result.sleeps.length, 2);
  assert.deepEqual(result.sleeps, [605, 605]);
  assert.equal(result.mark, '');
});

test('a secondary limit, with budget left, is waited out a minute at a time', () => {
  const result = paced({ answers: [{ stderr: secondary, status: 1 }, { stdout: 'ok\n' }], budget: [[4000, 1800]] });
  assert.equal(result.results[0].status, 0);
  assert.equal(result.results[0].stdout, 'ok');
  assert.match(result.results[0].stderr, /^ci-gate: the GitHub API rate limit is reached \(remaining 4000, resets \S+\); waiting until \S+$/);
  assert.deepEqual(result.sleeps, [60]);
});

test('a reset that moved while the window refilled and drained is waited for too', () => {
  const result = paced({ answers: [{ stderr: exhausted, status: 1 }, { stdout: 'ok\n' }], budget: [[0, 100], [0, 400], [4999, 3600]] });
  assert.equal(result.results[0].status, 0);
  assert.deepEqual(result.sleeps, [105, 405]);
});

test('a budget that cannot be read is waited a minute, then the read is made again', () => {
  const result = paced({ answers: [{ stderr: exhausted, status: 1 }, { stdout: 'ok\n' }], budget: [null] });
  assert.equal(result.results[0].status, 0);
  assert.match(result.results[0].stderr, /remaining unknown, resets unknown/);
  assert.deepEqual(result.sleeps, [60]);
});

test('a wait that would outlast 90 minutes is not begun: the limited answer is the caller\'s, and later ones come back at once until a read succeeds', () => {
  const result = paced(
    { answers: [{ stderr: exhausted, status: 1 }, { stderr: exhausted, status: 1 }, { stdout: 'ok\n' }], budget: [[0, 2 * 3600]] },
    [['run', 'view', '123'], ['run', 'view', '123'], ['run', 'view', '123']],
  );
  const [first, second, third] = result.results;
  assert.equal(first.status, 1);
  assert.equal(first.stderr, `ci-gate: the GitHub API rate limit would outlast 90 min of waiting (until 2026-11-10T14:00:05Z); no longer waiting for it\n${exhausted}`);
  assert.deepEqual(second, { status: 1, stdout: '', stderr: exhausted });
  assert.equal(third.status, 0);
  assert.deepEqual(result.sleeps, []);
  assert.equal(result.calls.filter((call) => call.startsWith('api rate_limit')).length, 1);
  assert.equal(result.mark, '');
});

test('the bound counts continuous exhaustion, a reset that keeps moving included', () => {
  const result = paced({ answers: [{ stderr: exhausted, status: 1 }], budget: [[0, 1800]] });
  assert.equal(result.results[0].status, 1);
  assert.deepEqual(result.sleeps, [1805, 1805]);
  assert.match(result.results[0].stderr, /would outlast 90 min of waiting \(until 2026-11-10T13:30:15Z\)/);
  assert.equal(result.mark, 'over');
});

test('a read that succeeds ends the exhaustion, and the next limit starts the bound again', () => {
  // A bound of 2000 s against resets 30 min out: each limit is waited out once, the third limit's second wait passes it.
  const result = paced(
    { answers: [{ stderr: exhausted, status: 1 }, { stdout: 'a\n' }, { stderr: exhausted, status: 1 }, { stdout: 'b\n' }, { stderr: exhausted, status: 1 }], budget: [[0, 1800], [4999, 3600], [0, 1800], [4999, 3600], [0, 1800], [0, 1800]] },
    [['run', 'view', '1'], ['run', 'view', '2'], ['run', 'view', '3']],
    { limitWait: 2000 },
  );
  assert.deepEqual(result.results.map(({ status, stdout }) => [status, stdout]), [[0, 'a'], [0, 'b'], [1, '']]);
  assert.deepEqual(result.sleeps, [1805, 1805, 1805]);
  assert.match(result.results[2].stderr, /would outlast 33 min of waiting/);
  assert.equal(result.mark, 'over');
});

test('any other failure, a 403 that is not the limit included, is the caller\'s at once', () => {
  for (const stderr of [forbidden, serverError, 'gh: HTTP 304']) {
    const result = paced({ answers: [{ stdout: 'HTTP/2.0 304 Not Modified\n', stderr, status: 1 }] });
    assert.deepEqual(result.results, [{ status: 1, stdout: 'HTTP/2.0 304 Not Modified', stderr }]);
    assert.deepEqual(result.sleeps, []);
    assert.ok(!result.calls.some((call) => call.startsWith('api rate_limit')));
    assert.equal(result.mark, '');
  }
});

test('a mark a killed call left under the same pid does not count as this call\'s exhaustion', () => {
  const result = paced({ answers: [{ stderr: exhausted, status: 1 }, { stdout: 'ok\n' }], budget: [[0, 600], [4999, 3600]] }, undefined, { staleMark: 'over' });
  assert.equal(result.results[0].status, 0);
  assert.deepEqual(result.sleeps, [605]);
});

test('a limit that ends in any other answer, a 304 included, ends the exhaustion: the next limit starts the bound again', () => {
  // A bound of 2000 s against resets 30 min out: a second limit that inherited the first's start would pass it at once.
  const notModified = { stdout: 'HTTP/2.0 304 Not Modified\n', stderr: 'gh: HTTP 304', status: 1 };
  const result = paced(
    { answers: [{ stderr: exhausted, status: 1 }, notModified, { stderr: exhausted, status: 1 }, { stdout: 'ok\n' }], budget: [[0, 1800], [4999, 3600], [0, 1800], [4999, 3600]] },
    [['api', '-i', 'one'], ['api', '-i', 'two']],
    { limitWait: 2000 },
  );
  assert.deepEqual(result.results.map(({ status, stdout }) => [status, stdout]), [[1, 'HTTP/2.0 304 Not Modified'], [0, 'ok']]);
  assert.doesNotMatch(result.results[1].stderr, /would outlast/);
  assert.deepEqual(result.sleeps, [1805, 1805]);
  assert.equal(result.mark, '');
});
