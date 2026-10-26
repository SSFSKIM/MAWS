import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./desktop-dock.sh', import.meta.url));

// A desktop: `defaults read com.apple.dock autohide`'s answer (null: the key is unset) and the main screen's frame and
// visible frame as AppKit reports them, the visible one per read, the last repeated.
function desktop(t, { autohide, frames, osascript = 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-desktop-dock-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const executable = (name, body) => writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  executable('defaults', autohide === null ? 'echo "The domain/default pair does not exist" >&2; exit 1' : `echo ${autohide}`);
  writeFileSync(join(dir, 'reads'), '0');
  writeFileSync(join(dir, 'frames'), `${frames.map((frame) => frame.join(' ')).join('\n')}\n`);
  executable('osascript', [
    `if [[ ${osascript} != 0 ]]; then exit ${osascript}; fi`,
    `n=$(cat '${join(dir, 'reads')}'); echo $((n + 1)) >'${join(dir, 'reads')}'`,
    `last=${frames.length}; line=$(( n + 1 < last ? n + 1 : last ))`,
    `sed -n "\${line}p" '${join(dir, 'frames')}'`,
  ].join('\n'));
  executable('sleep', '');
  return (...args) => spawnSync('/bin/bash', [script, ...args], { env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8' });
}

test('prints the Dock state and the visible frame: a shown Dock at the bottom takes its height', (t) => {
  const run = desktop(t, { autohide: 0, frames: [[1920, 1080, 1920, 987, 0, 68]] });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'dock autohide off visible 1920x987 at 0,68 of 1920x1080\n');
});

test('an unset autohide key is the default, off; a hidden Dock leaves all but the menu bar', (t) => {
  assert.equal(desktop(t, { autohide: null, frames: [[2560, 1440, 2560, 1415, 0, 0]] })().stdout, 'dock autohide off visible 2560x1415 at 0,0 of 2560x1440\n');
  assert.equal(desktop(t, { autohide: 1, frames: [[1920, 1080, 1920, 1055, 0, 0]] })().stdout, 'dock autohide on visible 1920x1055 at 0,0 of 1920x1080\n');
});

test('a fact it cannot read is unknown, and it still exits 0', (t) => {
  const result = desktop(t, { autohide: 'yes', frames: [[0]], osascript: 1 })();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'dock autohide unknown visible unknown\n');
});

test('--wait reads until the visible frame has the screen but its menu bar, then prints it', (t) => {
  const run = desktop(t, { autohide: 1, frames: [[1920, 1080, 1920, 987, 0, 68], [1920, 1080, 1920, 987, 0, 68], [1920, 1080, 1920, 1055, 0, 0]] });
  const result = run('--wait', '10');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'dock autohide on visible 1920x1055 at 0,0 of 1920x1080\n');
});

test('--wait gives up at its bound and prints what it read', (t) => {
  const result = desktop(t, { autohide: 1, frames: [[1920, 1080, 1920, 987, 0, 68]] })('--wait', '2');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'dock autohide on visible 1920x987 at 0,68 of 1920x1080\n');
});
