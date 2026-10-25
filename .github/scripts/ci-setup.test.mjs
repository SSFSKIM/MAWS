import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = join(root, '.github/ci-setup.sh');

function fixture(t, { platform = 'Darwin', mode = '1777', engine = 'working', download = 0, installed = 0 } = {}) {
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
  executable(join(bin, 'curl'), `echo "curl $*" >>"$CALLS"\nif [[ ${download} != 0 ]]; then exit ${download}; fi\ncat "$INSTALLER"`);
  const installer = join(dir, 'installer');
  executable(installer, `printf '#!/bin/bash\\nexit ${installed}\\n' >"$HOME/.local/bin/claude"\nchmod +x "$HOME/.local/bin/claude"`);
  if (engine !== 'missing') executable(join(home, '.local/bin/claude'), `exit ${engine === 'working' ? 0 : 1}`);
  return {
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
