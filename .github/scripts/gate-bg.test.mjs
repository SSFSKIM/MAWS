// node --test .github/scripts/gate-bg.test.mjs (from anywhere; no install needed). gate-bg.sh, static's checks at once
// on a machine with the memory for them and one at a time below it, run in bash as gate.yml runs it, from a checkout of
// a fake package.json and fake checks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL, fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./gate-bg.sh', import.meta.url));
const GiB = 1024 ** 3;

// A check, on node_modules/.bin as `pnpm run` has it: notes its start in the checkout's `events`, holds until a
// `release` file appears when told to (30 s at most), notes its end, prints a count line and exits with the status given.
const check = String.raw`#!/usr/bin/env bash
echo "start $1" >>events
if [[ $3 == hold ]]; then
  for _ in $(seq 1 600); do [[ -f release ]] && break; sleep 0.05; done
fi
echo "end $1" >>events
echo "$1: 1 passed"
exit "$2"
`;

// A checkout whose `typecheck` script is two checks, the second red, and gate-bg.sh run there under `memory` bytes (none:
// the machine's own reading).
function checkout(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-bg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
  mkdirSync(join(dir, 'runner-temp'));
  writeFileSync(join(dir, 'node_modules/.bin/check'), check);
  chmodSync(join(dir, 'node_modules/.bin/check'), 0o755);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { typecheck: 'check tc-a 0 hold && check tc-b 1 hold' } }));
  writeFileSync(join(dir, 'summary'), '');
  const env = { ...process.env };
  delete env.GATE_BG_MEMORY;
  const gateBg = (memory, ...args) =>
    spawnSync('bash', [script, ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...env, RUNNER_TEMP: join(dir, 'runner-temp'), GITHUB_STEP_SUMMARY: join(dir, 'summary'), ...(memory === undefined ? {} : { GATE_BG_MEMORY: String(memory) }) },
    });
  const events = () => (existsSync(join(dir, 'events')) ? readFileSync(join(dir, 'events'), 'utf8').trimEnd().split('\n') : []);
  const release = () => writeFileSync(join(dir, 'release'), '');
  return { dir, gateBg, events, release };
}

// gate.yml's start step, here a start-parts and a start, as two runs of the script.
const startAll = (gateBg, memory) => [gateBg(memory, 'start-parts', 'typecheck', 'passed', 'typecheck'), gateBg(memory, 'start', 'lint', 'passed', './node_modules/.bin/check', 'lint', '0', 'hold')];

// The wait steps read the same either way: each check's log, its time, the job's summary, and red if any check was.
function waited({ dir, gateBg }) {
  const wait = gateBg(undefined, 'wait', 'typecheck', 'lint');
  assert.equal(wait.status, 1, wait.stdout + wait.stderr);
  assert.match(wait.stdout, /^tc-a: 1 passed\ngate-bg: typecheck-1 passed in \d+ s\ntc-b: 1 passed\ngate-bg: typecheck-2 failed \(exit 1\) in \d+ s\nlint: 1 passed\ngate-bg: lint passed in \d+ s\n$/);
  const summary = readFileSync(join(dir, 'summary'), 'utf8');
  assert.match(summary, /^#### `bash -c check tc-a 0 hold` passed\n```\ntc-a: 1 passed\n```\n#### `bash -c check tc-b 1 hold` failed \(exit 1\)\n```\ntc-b: 1 passed\n```\n#### `\.\/node_modules\/\.bin\/check lint 0 hold` passed\n/);
}

test('with 24 GiB or more the checks start at once, each start returning while its check runs', async (t) => {
  const job = checkout(t);
  const [parts, lint] = startAll(job.gateBg, 32 * GiB);
  assert.equal(parts.status, 0, parts.stderr);
  assert.equal(
    parts.stdout,
    'gate-bg: 32.0 GiB of memory, 24 or more, so the checks run at once\ngate-bg: typecheck-1 started: bash -c check tc-a 0 hold\ngate-bg: typecheck-2 started: bash -c check tc-b 1 hold\n',
  );
  // The job's later starts keep its first start's decision, without saying it again.
  assert.equal(lint.status, 0, lint.stderr);
  assert.equal(lint.stdout, 'gate-bg: lint started: ./node_modules/.bin/check lint 0 hold\n');
  for (let i = 0; i < 300 && job.events().length < 3; i++) await sleep(50);
  assert.deepEqual(job.events().sort(), ['start lint', 'start tc-a', 'start tc-b']);
  job.release();
  waited(job);
});

test('under 24 GiB each start runs its check to its end, one at a time, and the wait steps read them the same', (t) => {
  const job = checkout(t);
  job.release();
  const [parts, lint] = startAll(job.gateBg, 16 * GiB);
  // A red check does not end the start step: its wait step is red.
  assert.equal(parts.status, 0, parts.stderr);
  assert.match(
    parts.stdout,
    /^gate-bg: 16\.0 GiB of memory, under 24, so the checks run one at a time\ngate-bg: typecheck-1 ran in \d+ s, exit 0: bash -c check tc-a 0 hold\ngate-bg: typecheck-2 ran in \d+ s, exit 1: bash -c check tc-b 1 hold\n$/,
  );
  assert.equal(lint.status, 0, lint.stderr);
  assert.match(lint.stdout, /^gate-bg: lint ran in \d+ s, exit 0: \.\/node_modules\/\.bin\/check lint 0 hold\n$/);
  assert.deepEqual(job.events(), ['start tc-a', 'end tc-a', 'start tc-b', 'end tc-b', 'start lint', 'end lint']);
  waited(job);
});

// /proc/meminfo's MemTotal on Linux and hw.memsize on macOS, the readings node's os.totalmem() takes too.
test("the decision is the machine's own memory without the test's stand-in", (t) => {
  const job = checkout(t);
  job.release();
  const [parts] = startAll(job.gateBg, undefined);
  assert.equal(parts.status, 0, parts.stderr);
  const gib = (totalmem() / GiB).toFixed(1);
  const mode = totalmem() >= 24 * GiB ? '24 or more, so the checks run at once' : 'under 24, so the checks run one at a time';
  assert.equal(parts.stdout.split('\n')[0], `gate-bg: ${gib} GiB of memory, ${mode}`);
  waited(job);
});
