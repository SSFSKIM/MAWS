import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = join(root, '.github/ci-setup.sh');
const MESLO = 'MesloLGMNerdFontMono-Regular.ttf';

function fixture(t, { platform = 'Darwin', mode = '1777', engine = 'working', download = 0, installed = 0, font = 'present', fontDownload = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-ci-setup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'), home = join(dir, 'home'), log = join(dir, 'log');
  mkdirSync(bin);
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  writeFileSync(log, '');
  const executable = (path, body) => writeFileSync(path, `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 });
  executable(join(bin, 'uname'), `echo '${platform}'`);
  executable(join(bin, 'stat'), mode === 'missing' ? 'exit 1' : `echo '${mode}:directory'`);
  executable(join(bin, 'sudo'), 'echo "sudo $*" >>"$CALLS"');
  // curl: the engine's installer to stdout; with -o (the font's archive), bytes that are not the pinned release's.
  executable(join(bin, 'curl'), [
    'echo "curl $*" >>"$CALLS"',
    'out=; prev=; for arg in "$@"; do if [[ $prev == -o ]]; then out=$arg; fi; prev=$arg; done',
    `if [[ -n $out ]]; then if [[ ${fontDownload} != 0 ]]; then exit ${fontDownload}; fi; printf 'not the pinned archive' >"$out"; exit 0; fi`,
    `if [[ ${download} != 0 ]]; then exit ${download}; fi`,
    'cat "$INSTALLER"',
  ].join('\n'));
  const installer = join(dir, 'installer');
  executable(installer, `printf '#!/bin/bash\\nexit ${installed}\\n' >"$HOME/.local/bin/claude"\nchmod +x "$HOME/.local/bin/claude"`);
  if (engine !== 'missing') executable(join(home, '.local/bin/claude'), `exit ${engine === 'working' ? 0 : 1}`);
  const fonts = join(home, 'Library/Fonts');
  mkdirSync(fonts, { recursive: true });
  if (font === 'present') writeFileSync(join(fonts, MESLO), 'a font installed by hand');
  return {
    fonts: () => readdirSync(fonts),
    run: () => spawnSync('/bin/bash', [script], {
      cwd: root,
      env: { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, CALLS: log, INSTALLER: installer, CI: 'true' },
      encoding: 'utf8',
    }),
    calls: () => readFileSync(log, 'utf8'),
  };
}

for (const platform of ['Darwin', 'Linux']) {
  test(`${platform}: a runnable engine and satisfied fixtures need no install`, (t) => {
    const f = fixture(t, { platform });
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.calls(), '');
  });
}

for (const engine of ['missing', 'broken']) {
  test(`Linux does not install a ${engine} engine that its gates never launch`, (t) => {
    const f = fixture(t, { platform: 'Linux', engine });
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.calls(), '');
  });

  test(`a ${engine} native engine is installed once and then reused`, (t) => {
    const f = fixture(t, { engine });
    const first = f.run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(f.calls(), /curl .*https:\/\/claude.ai\/install.sh/);
    const calls = f.calls();
    const second = f.run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(f.calls(), calls);
  });
}

test('an installer download failure fails setup', (t) => {
  const f = fixture(t, { engine: 'missing', download: 22 });
  assert.notEqual(f.run().status, 0);
  assert.match(f.calls(), /curl /);
});

test('an installer that leaves an unusable binary fails setup', (t) => {
  const f = fixture(t, { engine: 'missing', installed: 1 });
  assert.notEqual(f.run().status, 0);
  assert.match(f.calls(), /curl /);
});

for (const mode of ['755', 'missing']) {
  test(`Linux repairs a ${mode} fixture directory without touching the engine`, (t) => {
    const f = fixture(t, { platform: 'Linux', mode });
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.calls(), 'sudo -n install -d -m 1777 /private/tmp\n');
  });
}

test('macOS leaves its own fixture directory alone', (t) => {
  const f = fixture(t, { platform: 'Darwin', mode: '755' });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.calls(), '');
});

const MESLO_URL = /^curl .*https:\/\/github\.com\/ryanoasis\/nerd-fonts\/releases\/download\/v3\.5\.1\/Meslo\.tar\.xz\n$/;

test('a Mac with MesloLGM Nerd Font Mono, however it came, fetches nothing', (t) => {
  const f = fixture(t, { font: 'present' });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.calls(), '');
});

test('a Mac without the font fetches the pinned release, and refuses an archive whose sha256 is not the pin before unpacking it', (t) => {
  const f = fixture(t, { font: 'missing' });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(f.calls(), MESLO_URL);
  assert.match(result.stderr, /MAWS setup: refused: .*Meslo\.tar\.xz.* sha256 [0-9a-f]{64}, not the pinned 6b6624632dc6873dfb7681c3f818e7c01ab601ab707690b6440933bbe57e2b11/);
  assert.deepEqual(f.fonts(), []);
});

test('a font download that fails fails setup', (t) => {
  const f = fixture(t, { font: 'missing', fontDownload: 22 });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(f.calls(), MESLO_URL);
  assert.match(result.stderr, /MAWS setup: could not download/);
  assert.deepEqual(f.fonts(), []);
});

test('Linux never fetches the font', (t) => {
  const f = fixture(t, { platform: 'Linux', font: 'missing' });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.calls(), '');
});
