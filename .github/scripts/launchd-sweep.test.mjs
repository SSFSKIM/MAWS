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
function scene(t, loaded) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'launchd-sweep-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  const agents = join(home, 'Library/LaunchAgents');
  mkdirSync(agents, { recursive: true });
  const state = join(dir, 'loaded');
  writeFileSync(state, loaded.map((label) => `${label}\n`).join(''));
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
    grep -vxF "$label" "$state" >"$state.next" || true
    mv "$state.next" "$state" ;;
esac
`,
  );
  chmodSync(launchctl, 0o755);
  const run = (env = {}) => spawnSync('bash', [script], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, LAUNCHCTL: launchctl, ...env } });
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

test('refuses arguments', () => {
  const run = spawnSync('bash', [script, 'all'], { encoding: 'utf8', env: { PATH: process.env.PATH, LAUNCHCTL: '/nonexistent/launchctl' } });
  assert.equal(run.status, 2);
  assert.equal(run.stderr, 'usage: launchd-sweep.sh\n');
});
