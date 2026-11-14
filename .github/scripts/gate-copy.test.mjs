// node --test .github/scripts/gate-copy.test.mjs (no install needed). gate.yml's e2e-copy slots: a group cut at its
// bound leaves no process to the next slot or the verdict, and its verdict line says it was cut.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// A checkout holding the job's scripts, and a pnpm that runs the slot's SCRIPT as a shell command.
function checkout(t) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-gate-copy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.github/scripts'), { recursive: true });
  for (const script of ['gate-copy.sh', 'gate-run.sh']) cpSync(join(root, '.github/scripts', script), join(dir, '.github/scripts', script));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/pnpm'), '#!/usr/bin/env bash\neval "$1"\n');
  chmodSync(join(dir, 'bin/pnpm'), 0o755);
  mkdirSync(join(dir, 'temp'));
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, RUNNER_TEMP: join(dir, 'temp'), GITHUB_SHA: '0123abcd', GITHUB_STEP_SUMMARY: join(dir, 'summary'), REAP_GRACE: '2' };
  const slot = (number, script) => spawn('bash', ['.github/scripts/gate-copy.sh', 'run', String(number)], { cwd: dir, env: { ...env, SCRIPT: script }, stdio: 'ignore' });
  const verdict = (groups, outcomes) => spawnSync('bash', ['.github/scripts/gate-copy.sh', 'verdict'], { cwd: dir, env: { ...env, COPY_GROUPS: groups, OUTCOMES: outcomes }, encoding: 'utf8' });
  return { dir, env, slot, verdict };
}

test('a slot cut at its bound leaves nothing running: the next slot stops its process group, and the verdict says it was cut', async (t) => {
  const { dir, env, slot, verdict } = checkout(t);
  // The group writes its pid, then outlives the step's shell, as Playwright does when Actions ends the step.
  const pidFile = join(dir, 'temp/leftover.pid');
  const first = slot(1, `sleep 300 & echo $! > ${pidFile}; wait`);
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await sleep(50);
  const leftover = Number(readFileSync(pidFile, 'utf8'));
  first.kill('SIGKILL'); // the step's shell, ended at the step's timeout
  await new Promise((resolve) => first.on('exit', resolve));
  assert.ok(alive(leftover), 'the group outlives its step');
  // The next slot runs only once the first slot's group is gone.
  const second = spawnSync('bash', ['.github/scripts/gate-copy.sh', 'run', '2'], { cwd: dir, env: { ...env, SCRIPT: 'echo second' }, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /^gate-copy: stopped what slot 1 left running \(process group \d+\)$/m);
  assert.ok(!alive(leftover), 'the cut group is stopped before the next slot runs');
  const result = verdict('to-human, c12', 'failure success');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^mini copy: e2e:to-human failure, cut at its bound, its processes stopped in \d+ min$/m);
  assert.match(result.stdout, /^mini copy: e2e:c12 success in \d+ min$/m);
  assert.match(readFileSync(join(dir, 'summary'), 'utf8'), /\| e2e:to-human \| failure, cut at its bound, its processes stopped \| \d+ \|/);
});

test('the verdict stops the last slot when it was cut, and a slot that finished keeps its plain line', async (t) => {
  const { dir, slot, verdict } = checkout(t);
  const pidFile = join(dir, 'temp/leftover.pid');
  const only = slot(1, `sleep 300 & echo $! > ${pidFile}; wait`);
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await sleep(50);
  const leftover = Number(readFileSync(pidFile, 'utf8'));
  only.kill('SIGKILL');
  await new Promise((resolve) => only.on('exit', resolve));
  const result = verdict('to-human', 'failure');
  assert.ok(!alive(leftover));
  assert.match(result.stdout, /^mini copy: e2e:to-human failure, cut at its bound, its processes stopped/m);
  // A red that ran to its end is a plain failure, its log's tail printed.
  const { slot: again, verdict: judge } = checkout(t);
  await new Promise((resolve) => again(1, 'echo "  1 failed"; exit 1').on('exit', resolve));
  const red = judge('c12', 'failure');
  assert.match(red.stdout, /^mini copy: e2e:c12 failure in \d+ min\nmini copy: e2e:c12, the last lines of its log:\n/m);
  assert.doesNotMatch(red.stdout, /cut at its bound/);
});
