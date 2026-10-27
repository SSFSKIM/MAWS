// node --test .github/scripts/gate-peer.test.mjs (from anywhere; no install needed). gate-peer.sh, a PEER_E2E group's peer
// build in gate.yml's e2e job, run in bash as the job runs it: `prepare` against a local origin and a fake pnpm, `stop`
// against stand-in supervisors and apps that name the two checkouts as the real ones do.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL, fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./gate-peer.sh', import.meta.url));

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gate-peer-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` };
  for (const role of ['AUTHOR', 'COMMITTER']) Object.assign(env, { [`GIT_${role}_NAME`]: 'gate-peer test', [`GIT_${role}_EMAIL`]: 'gate-peer@test.invalid' });
  mkdirSync(join(dir, 'bin'));
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', env }).trim();
  return { dir, env, git };
}

test('prepare fetches the one commit, checks it out as a worktree, installs it and builds it through its own e2e-build.sh plain, uncached', (t) => {
  const { dir, env, git } = scratch(t);
  // the origin: the peer's commit, then the tested one; the checkout holds only the tested one, as actions/checkout does
  const work = join(dir, 'work');
  git('init', '--quiet', '-b', 'master', work);
  mkdirSync(join(work, 'scripts'));
  writeFileSync(join(work, 'scripts/e2e-build.sh'), '#!/usr/bin/env bash\necho "e2e-build $1 cache=[${MAWS_E2E_BUILD_CACHE:-}] key=[${MAWS_E2E_BUILD_KEY:-}]" >>"$CALLS"\nmkdir -p out/main\n');
  chmodSync(join(work, 'scripts/e2e-build.sh'), 0o755);
  writeFileSync(join(work, 'which'), 'peer\n');
  git('-C', work, 'add', '-A');
  git('-C', work, 'commit', '--quiet', '-m', 'peer');
  const peer = git('-C', work, 'rev-parse', 'HEAD');
  writeFileSync(join(work, 'which'), 'tested\n');
  git('-C', work, 'commit', '--quiet', '-am', 'tested');
  const origin = join(dir, 'origin.git');
  git('clone', '--quiet', '--bare', work, origin);
  const checkout = join(dir, 'checkout');
  git('clone', '--quiet', '--depth=1', `file://${origin}`, checkout);
  writeFileSync(join(dir, 'bin/pnpm'), '#!/usr/bin/env bash\necho "pnpm $* in $PWD" >>"$CALLS"\n');
  chmodSync(join(dir, 'bin/pnpm'), 0o755);
  const calls = join(dir, 'calls');
  const into = join(dir, 'runner-temp/maws-peer');
  // a previous job's peer, left registered and on disk by a job that never reached its stop, goes
  git('-C', checkout, 'worktree', 'add', '--quiet', '--detach', into);
  writeFileSync(join(into, 'stale'), '');
  // set in the job's environment by the e2e lane; the peer's build must not read or write that cache
  const run = spawnSync('bash', [script, 'prepare', peer, into], { cwd: checkout, encoding: 'utf8', env: { ...env, CALLS: calls, MAWS_E2E_BUILD_CACHE: join(dir, 'cache'), MAWS_E2E_BUILD_KEY: peer } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, new RegExp(`^gate-peer: ${peer} checked out at ${into}\n`, 'm'));
  assert.match(run.stdout, new RegExp(`^gate-peer: ${peer} built at ${into}/out$`, 'm'));
  assert.equal(readFileSync(join(into, 'which'), 'utf8'), 'peer\n');
  assert.equal(existsSync(join(into, 'stale')), false);
  assert.equal(git('-C', into, 'rev-parse', 'HEAD'), peer);
  assert.equal(git('-C', checkout, 'rev-parse', 'HEAD'), git('-C', work, 'rev-parse', 'HEAD'), 'the checkout itself stays on the tested commit');
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [`pnpm install --frozen-lockfile --prefer-offline in ${into}`, 'e2e-build plain cache=[] key=[]']);
});

test('prepare refuses anything but a full sha and a directory', (t) => {
  const { dir, env } = scratch(t);
  for (const args of [['prepare', 'abc123', join(dir, 'p')], ['prepare', 'f'.repeat(40)], ['stop'], ['restart', dir]]) {
    const run = spawnSync('bash', [script, ...args], { cwd: dir, encoding: 'utf8', env });
    assert.equal(run.status, 2, args.join(' '));
    assert.equal(run.stderr, 'usage: gate-peer.sh prepare <sha> <dir> | stop <dir>\n');
  }
});

// A stand-in process whose command line reads `command` (bash's exec -a), in a process group of its own when `leads`
// (as the detached supervisor is), with a child in that group when it has `engine`.
function standIn(command, { leads = false, engine = false } = {}) {
  const child = spawn('bash', ['-c', `${engine ? 'sleep 300 & ' : ''}exec -a "$0" sleep 300`, command], { detached: leads, stdio: 'ignore' });
  return child;
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const groupOf = (pgid) => spawnSync('ps', ['-ww', '-axo', 'pid=,pgid='], { encoding: 'utf8' }).stdout.split('\n').map((line) => line.trim().split(/\s+/).map(Number)).filter(([, group]) => group === pgid).map(([pid]) => pid);

test("stop kills every supervisor of either checkout with its group, and the apps run from either; another root's supervisor stays", async (t) => {
  const { dir, env } = scratch(t);
  const here = join(dir, 'checkout');
  const peer = join(dir, 'runner-temp/maws-peer');
  mkdirSync(join(peer, 'out'), { recursive: true });
  mkdirSync(here);
  const ours = [
    standIn(`maws-supervisor --disable-sigusr1 ${here}/out/main/index-a.js --detached ${dir}/maws-e10-x/ud/supervisor`, { leads: true, engine: true }),
    standIn(`maws-supervisor --disable-sigusr1 ${peer}/out/main/index-b.js --detached ${dir}/maws-e10-y/ud/supervisor`, { leads: true, engine: true }),
    standIn(`${peer}/node_modules/electron/dist/Electron --lang=en-US ${peer}/out/main/index.js`),
    standIn(`${here}/node_modules/electron/dist/Electron --lang=en-US ${here}/out/main/index.js`),
  ];
  const theirs = standIn(`maws-supervisor --disable-sigusr1 /Applications/MAWS.app/Contents/Resources/app.asar/out/main/index-c.js --detached ${dir}/owner/supervisor`, { leads: true });
  t.after(() => {
    for (const child of [...ours, theirs]) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        if (alive(child.pid)) process.kill(child.pid, 'SIGKILL');
      }
    }
  });
  await sleep(300); // each has exec'd under its name
  const engines = ours.slice(0, 2).flatMap((child) => groupOf(child.pid).filter((pid) => pid !== child.pid));
  assert.equal(engines.length, 2, 'each supervisor stand-in has an engine in its group');
  const run = spawnSync('bash', [script, 'stop', peer], { cwd: here, encoding: 'utf8', env });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const child of ours) assert.match(run.stdout, new RegExp(`^gate-peer: stopped (supervisor )?pid ${child.pid}: `, 'm'));
  await sleep(300);
  for (const pid of [...ours.map((child) => child.pid), ...engines]) assert.equal(alive(pid) && !zombie(pid), false, `pid ${pid} is gone`);
  assert.equal(alive(theirs.pid), true, "the owner's supervisor is not the job's");
  assert.doesNotMatch(run.stdout, new RegExp(`pid ${theirs.pid}:`));
  assert.equal(existsSync(peer), false, 'the peer checkout goes too');
});

// A killed child of this process stays a zombie until it is reaped, which `alive` cannot tell from a live one.
const zombie = (pid) => /^Z/.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim());
