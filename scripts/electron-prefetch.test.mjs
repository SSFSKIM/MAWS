import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./electron-prefetch.mjs', import.meta.url));
const postinstall = fileURLToPath(new URL('./postinstall.mjs', import.meta.url));
const hash = createHash('sha256').update('https://github.com/electron/electron/releases/download/v44.4.5').digest('hex');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'electron-prefetch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'), cache = join(dir, 'cache'), log = join(dir, 'calls');
  mkdirSync(bin);
  writeFileSync(log, '');
  writeFileSync(join(bin, 'curl'), `#!/bin/bash
set -eu
printf '%s\\n' "$*" >>"$CALLS"
[[ \${NO_NETWORK:-0} != 1 ]] || exit 99
out=; prev=; for arg in "$@"; do if [[ $prev == -o ]]; then out=$arg; fi; prev=$arg; done
printf 'zip bytes' >"$out"
`, { mode: 0o755 });
  writeFileSync(join(bin, 'install-electron'), '#!/bin/bash\necho installer >>"$CALLS"\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: log, electron_config_cache: cache, ELECTRON_INSTALL_PLATFORM: 'linux', ELECTRON_INSTALL_ARCH: 'x64', ELECTRON_SKIP_BINARY_DOWNLOAD: '0' };
  return { dir, cache, log, run: (entry = script, overrides = {}) => spawnSync(process.execPath, [entry], { cwd: dir, env: { ...env, ...overrides }, encoding: 'utf8' }) };
}

test('prefetch uses the Electron v5 cache key and reuses a cached zip without the network', (t) => {
  const f = fixture(t);
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(join(f.cache, hash, 'electron-v44.4.5-linux-x64.zip'), 'utf8'), 'zip bytes');
  const calls = readFileSync(f.log, 'utf8');
  assert.match(calls, /https:\/\/github.com\/electron\/electron\/releases\/download\/v44.4.5\/electron-v44.4.5-linux-x64.zip/);
  const second = f.run(script, { NO_NETWORK: '1' });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(f.log, 'utf8'), calls);
});

test('postinstall primes the cache before starting the installer', (t) => {
  const f = fixture(t);
  const r = f.run(postinstall);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(f.cache, hash, 'electron-v44.4.5-linux-x64.zip'), 'utf8'), 'zip bytes');
  assert.match(readFileSync(f.log, 'utf8'), /https:\/\/github.com[^\n]+\ninstaller\n$/);
});

test('a failed prefetch does not launch the installer on an empty cache', (t) => {
  const f = fixture(t);
  const r = f.run(postinstall, { NO_NETWORK: '1' });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(readFileSync(f.log, 'utf8'), /installer/);
});

test('skip binary download avoids both the prefetch and the installer', (t) => {
  const f = fixture(t);
  assert.equal(f.run(postinstall, { ELECTRON_SKIP_BINARY_DOWNLOAD: '1', NO_NETWORK: '1' }).status, 0);
  assert.equal(readFileSync(f.log, 'utf8'), '');
});

for (const entry of [script, postinstall]) {
  test(`${entry === script ? 'setup prefetch' : 'postinstall'} succeeds offline with installed Electron and an empty cache`, (t) => {
    const f = fixture(t);
    const electron = join(f.dir, 'node_modules/electron');
    mkdirSync(join(electron, 'dist'), { recursive: true });
    writeFileSync(join(electron, 'dist/version'), '44.4.5');
    writeFileSync(join(electron, 'path.txt'), 'electron');
    writeFileSync(join(electron, 'dist/electron'), 'installed binary');
    const r = f.run(entry, { NO_NETWORK: '1' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(f.log, 'utf8'), entry === script ? '' : 'installer\n');
  });
}

for (const damage of ['version', 'path', 'binary']) {
  test(`an installed Electron with a wrong ${damage} still needs a prefetch`, (t) => {
    const f = fixture(t);
    const electron = join(f.dir, 'node_modules/electron');
    mkdirSync(join(electron, 'dist'), { recursive: true });
    writeFileSync(join(electron, 'dist/version'), damage === 'version' ? '43.0.0' : '44.4.5');
    writeFileSync(join(electron, 'path.txt'), damage === 'path' ? 'wrong' : 'electron');
    if (damage !== 'binary') writeFileSync(join(electron, 'dist/electron'), 'installed binary');
    const r = f.run(postinstall, { NO_NETWORK: '1' });
    assert.notEqual(r.status, 0);
    assert.match(readFileSync(f.log, 'utf8'), /https:\/\/github.com/);
    assert.doesNotMatch(readFileSync(f.log, 'utf8'), /installer/);
  });
}

test('the installed check matches Electron’s platform path, v-prefixed version and override path', (t) => {
  const f = fixture(t);
  const electron = join(f.dir, 'node_modules/electron');
  mkdirSync(join(electron, 'dist'), { recursive: true });
  writeFileSync(join(electron, 'dist/version'), 'v44.4.5');
  writeFileSync(join(electron, 'path.txt'), 'Electron.app/Contents/MacOS/Electron');
  const override = join(f.dir, 'custom-dist');
  mkdirSync(override);
  const r = f.run(postinstall, { NO_NETWORK: '1', ELECTRON_INSTALL_PLATFORM: 'darwin', ELECTRON_OVERRIDE_DIST_PATH: override });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(f.log, 'utf8'), 'installer\n');
});
