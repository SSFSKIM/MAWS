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
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, RUNNER_TEMP: join(dir, 'temp'), GITHUB_SHA: '0123abcd', GITHUB_STEP_SUMMARY: join(dir, 'summary'), REAP_GRACE: '2', STRAY_NAMES: `${dir}/no-such-scratch-` };
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

const waitFor = async (file) => { for (let i = 0; i < 100 && !existsSync(file); i++) await sleep(50); return Number(readFileSync(file, 'utf8')); };
// A process in a session and group of its own, as detached-transport.ts spawns a private host, in the slot's checkout.
const detached = (pidFile) => `perl -MPOSIX -e 'POSIX::setsid(); open my $f, ">", "${pidFile}"; print $f $$; close $f; exec "sleep", "300"' & sleep 300`;

test("a cut slot's detached descendant, outside its group, is stopped too", async (t) => {
  const { dir, env, slot } = checkout(t);
  const pidFile = join(dir, 'temp/detached.pid');
  const first = slot(1, detached(pidFile));
  const host = await waitFor(pidFile);
  t.after(() => { try { process.kill(host, 'SIGKILL'); } catch { /* gone */ } });
  first.kill('SIGKILL');
  await new Promise((resolve) => first.on('exit', resolve));
  const second = spawnSync('bash', ['.github/scripts/gate-copy.sh', 'run', '2'], { cwd: dir, env: { ...env, SCRIPT: 'echo second' }, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, new RegExp(`^gate-copy: stopped what slot 1 left outside its group: (\\d+ )*${host}( \\d+)*$`, 'm'));
  assert.ok(!alive(host));
});

test('a record whose leader pid now belongs to another process is dropped without a signal', async (t) => {
  const { dir, env } = checkout(t);
  // A live group leader the slot never started: its start time is not the record's.
  const pidFile = join(dir, 'temp/other.pid');
  const other = spawn('perl', ['-MPOSIX', '-e', `POSIX::setsid(); open my $f, ">", "${pidFile}"; print $f $$; close $f; sleep 300`], { cwd: tmpdir(), stdio: 'ignore' });
  t.after(() => other.kill('SIGKILL'));
  const pid = await waitFor(pidFile);
  mkdirSync(join(dir, 'temp/maws-copy'), { recursive: true });
  writeFileSync(join(dir, 'temp/maws-copy/1.pgid'), `${pid}\tMon Jan  1 00:00:00 2001\n`);
  writeFileSync(join(dir, 'temp/maws-copy/1.status'), '0\n');
  const result = spawnSync('bash', ['.github/scripts/gate-copy.sh', 'run', '2'], { cwd: dir, env: { ...env, SCRIPT: 'echo second' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /stopped what slot 1/);
  assert.ok(alive(pid), 'a process of another start is never signalled');
  assert.ok(!existsSync(join(dir, 'temp/maws-copy/1.pgid')));
});

test('what outlives SIGKILL fails the reap: the next slot does not start, its record stays, and the verdict is red', async (t) => {
  const { dir, env, slot, verdict } = checkout(t);
  // A stray in the checkout whose parent, outside it, never reaps it: killed, it stays a zombie, its start time readable.
  const pidFile = join(dir, 'temp/zombie.pid');
  const parent = spawn('perl', ['-e', `my $c = fork; if (!$c) { chdir "${dir}"; exec "sleep", "300" } open my $f, ">", "${pidFile}"; print $f $c; close $f; sleep 300`], { cwd: tmpdir(), stdio: 'ignore' });
  t.after(() => parent.kill('SIGKILL'));
  await waitFor(pidFile);
  const first = slot(1, 'sleep 300');
  for (let i = 0; i < 100 && !existsSync(join(dir, 'temp/maws-copy/1.pgid')); i++) await sleep(50);
  first.kill('SIGKILL');
  await new Promise((resolve) => first.on('exit', resolve));
  const second = spawnSync('bash', ['.github/scripts/gate-copy.sh', 'run', '2'], { cwd: dir, env: { ...env, SCRIPT: `echo ran > ${join(dir, 'temp/second-ran')}` }, encoding: 'utf8' });
  assert.equal(second.status, 1);
  assert.match(second.stderr, /^gate-copy: processes outlived SIGKILL: \d+/m);
  assert.ok(!existsSync(join(dir, 'temp/second-ran')), 'the next slot does not start');
  assert.ok(existsSync(join(dir, 'temp/maws-copy/1.pgid')), 'the record stays');
  const result = verdict('to-human, c12', 'failure failure');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^mini copy: what a slot left running could not be stopped \(above\); the job is red$/m);
});
