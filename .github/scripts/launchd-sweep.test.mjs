// node --test .github/scripts/launchd-sweep.test.mjs (from anywhere; no install needed). launchd-sweep.sh, e2e:daemon-unit's
// cleanup, run in bash as the gate job runs it, against a stand-in launchctl (LAUNCHCTL) and a scratch HOME: the real
// launchd is never reached, on a Mac either.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./launchd-sweep.sh', import.meta.url));
const uid = process.getuid();

// A launchctl that records its calls and answers `print` from the loaded labels: the domain's listing (in launchctl's
// own layout, a disabled-services entry among it) and each service, which `bootout` unloads.
function scene(t, loaded, stuck = []) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'launchd-sweep-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  const agents = join(home, 'Library/LaunchAgents');
  mkdirSync(agents, { recursive: true });
  const state = join(dir, 'loaded');
  writeFileSync(state, loaded.map((label) => `${label}\n`).join(''));
  const stuckFile = join(dir, 'stuck'); // jobs whose bootout fails, and which stay loaded
  writeFileSync(stuckFile, stuck.map((label) => `${label}\n`).join(''));
  const calls = join(dir, 'calls');
  const launchctl = join(dir, 'launchctl');
  writeFileSync(
    launchctl,
    `#!/usr/bin/env bash
echo "$*" >>${JSON.stringify(calls)}
state=${JSON.stringify(state)}
case $1 in
  print)
    if [[ $2 == gui/${uid} ]]; then
      echo "gui/${uid} = {"
      echo "	services = {"
      while IFS= read -r label; do echo "		0	-	$label"; done <"$state"
      echo "	}"
      echo "	disabled services = {"
      echo '		"dev.maws.mawsd.e2e-old-x" => disabled'
      echo "	}"
      echo "}"
      exit 0
    fi
    grep -qxF "\${2#gui/${uid}/}" "$state" && exit 0
    exit 113 ;;
  bootout)
    label=\${2#gui/${uid}/}
    if grep -qxF "$label" ${JSON.stringify(stuckFile)}; then echo 'Boot-out failed: 5: Input/output error' >&2; exit 5; fi
    grep -vxF "$label" "$state" >"$state.next" || true
    mv "$state.next" "$state" ;;
esac
`,
  );
  chmodSync(launchctl, 0o755);
  const run = (env = {}) => spawnSync('bash', [script], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, LAUNCHCTL: launchctl, LAUNCHD_SWEEP_WAIT_TENTHS: '3', ...env } });
  const plist = (label) => writeFileSync(join(agents, `${label}.plist`), '<plist/>\n');
  return { agents, calls: () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []), loaded: () => readFileSync(state, 'utf8').trim().split('\n').filter(Boolean), plist, run };
}

test('boots out and removes every e2e label, loaded or only on disk, and leaves the owner’s daemon and every other label', (t) => {
  const owner = 'dev.maws.mawsd';
  const a = 'dev.maws.mawsd.e2e-40563335469-1-a';
  const b = 'dev.maws.mawsd.e2e-40563335469-1-restart';
  const orphan = 'dev.maws.mawsd.e2e-9f8e7d6c-a'; // a plist a killed run left, never loaded
  const s = scene(t, ['com.apple.Finder', owner, a, b]);
  for (const label of [owner, a, orphan, 'com.example.other']) s.plist(label);

  const run = s.run();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(s.loaded(), ['com.apple.Finder', owner], 'only the e2e jobs are booted out');
  assert.deepEqual(readdirSync(s.agents).sort(), [`com.example.other.plist`, `${owner}.plist`], 'only the e2e plists are removed');
  assert.deepEqual(s.calls().filter((call) => call.startsWith('bootout')), [`bootout gui/${uid}/${a}`, `bootout gui/${uid}/${b}`]);
  assert.ok(!s.calls().some((call) => call.includes(`gui/${uid}/${owner}`) && !call.includes('.e2e-')), 'the owner’s label is never addressed');
  assert.match(run.stdout, new RegExp(`^launchd-sweep: booted out ${a}$`, 'm'));
  assert.match(run.stdout, new RegExp(`^launchd-sweep: removed ${s.agents}/${orphan}\\.plist$`, 'm'));
  // the disabled-services entry is an e2e label too: looked up, not booted out (nothing loaded), nothing on disk
  assert.match(run.stdout, new RegExp(`^launchd-sweep: 4 e2e label\\(s\\) under dev\\.maws\\.mawsd\\.e2e- swept in gui/${uid}$`, 'm'));

  const again = s.run();
  assert.equal(again.status, 0);
  assert.match(again.stdout, /^launchd-sweep: 1 e2e label\(s\) under/m, 'a second sweep finds only the disabled entry, and touches nothing');
  assert.deepEqual(s.loaded(), ['com.apple.Finder', owner]);
});

test('with nothing to sweep it says so and succeeds; with no launchctl it touches nothing', (t) => {
  const s = scene(t, ['com.apple.Finder']);
  const run = s.run();
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^launchd-sweep: 1 e2e label\(s\)/m); // the scene's disabled entry
  const none = s.run({ LAUNCHCTL: '/nonexistent/launchctl' });
  assert.equal(none.status, 0);
  assert.equal(none.stdout, 'launchd-sweep: no /nonexistent/launchctl here; nothing to sweep\n');
});

// M7 review I3: a label is checked whole before each bootout and each removal, so no part of a file name is ever taken
// for a label: a name holding a space or a newline after the prefix is skipped and named, and the owner's job and plist
// are never addressed.
test('never word-splits a name: a plist named with a space or a newline after the prefix is skipped, and no other job or plist is addressed', (t) => {
  const owner = 'com.example.owner';
  const e2e = 'dev.maws.mawsd.e2e-1-1-unit';
  const s = scene(t, [owner, 'dev.maws.mawsd', e2e]);
  const spaced = `dev.maws.mawsd.e2e-old ${owner}`;
  const broken = `dev.maws.mawsd.e2e-x\n${owner}`;
  for (const label of [owner, 'dev.maws.mawsd', e2e, spaced, broken]) s.plist(label);

  const run = s.run();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(s.loaded(), [owner, 'dev.maws.mawsd'], 'only the one whole e2e job is booted out');
  assert.deepEqual(readdirSync(s.agents).sort(), [`${broken}.plist`, `${spaced}.plist`, `${owner}.plist`, 'dev.maws.mawsd.plist'].sort(), 'only the whole e2e plist is removed');
  const addressing = s.calls().filter((call) => call !== `print gui/${uid}`);
  // the e2e job, and the scene's disabled e2e entry (looked up, never loaded); never the owner's or any other
  assert.ok(addressing.every((call) => /^(print|bootout) gui\/\d+\/dev\.maws\.mawsd\.e2e-[A-Za-z0-9._-]+$/.test(call)), `every call names a whole e2e label: ${JSON.stringify(addressing)}`);
  assert.ok(addressing.some((call) => call === `bootout gui/${uid}/${e2e}`));
  assert.ok(!addressing.some((call) => call.includes(owner) || call.includes('e2e-old ') || call.includes('e2e-x')));
  const skipped = run.stdout.split('\n').filter((line) => line.startsWith('launchd-sweep: skipped '));
  assert.equal(skipped.length, 2, run.stdout);
  assert.ok(skipped.every((line) => line.endsWith(': not an e2e label')));
});

// M7 review I4: a job still loaded after its bootout fails the sweep, after a bounded wait, and the rest is still swept.
test('fails, naming it, when a job is still loaded after its bootout; the others are swept all the same', (t) => {
  const stuck = 'dev.maws.mawsd.e2e-1-1-stuck';
  const gone = 'dev.maws.mawsd.e2e-1-1-gone';
  const s = scene(t, [stuck, gone], [stuck]);
  s.plist(stuck);
  s.plist(gone);
  const run = s.run();
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, new RegExp(`^launchd-sweep: ${stuck} is still loaded after its bootout$`, 'm'));
  assert.match(run.stdout, new RegExp(`^launchd-sweep: booted out ${gone}$`, 'm'));
  assert.equal(run.stderr, `launchd-sweep: 1 job(s) still loaded: ${stuck}\n`);
  assert.deepEqual(s.loaded(), [stuck]);
  assert.ok(s.calls().filter((call) => call === `print gui/${uid}/${stuck}`).length >= 3, 'it looked again within its bound before failing');
});

test('refuses arguments', () => {
  const run = spawnSync('bash', [script, 'all'], { encoding: 'utf8', env: { PATH: process.env.PATH, LAUNCHCTL: '/nonexistent/launchctl' } });
  assert.equal(run.status, 2);
  assert.equal(run.stderr, 'usage: launchd-sweep.sh\n');
});
