import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./release-fetch.sh', import.meta.url));
function fixture(t, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-fetch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dest = join(dir, 'asset.zip'), log = join(dir, 'calls'), headers = join(dir, 'headers');
  writeFileSync(dest, 'old destination');
  writeFileSync(log, '');
  writeFileSync(headers, '');
  writeFileSync(join(dir, 'curl'), `#!/bin/bash
set -eu
printf '%s\\n' "$*" >>"$CALLS"
for arg in "$@"; do if [[ $arg == @- ]]; then cat >>"$HEADER_INPUT"; fi; done
out=; prev=; for arg in "$@"; do if [[ $prev == -o ]]; then out=$arg; fi; prev=$arg; done
url=\${!#}
case "$url" in
  https://github.com/o/r/releases/download/v1/asset.zip)
    printf 'partial' >"$out"
    [[ \${WEB_OK:-0} == 1 ]] || exit 22
    printf 'web bytes' >"$out" ;;
  https://api.github.com/repos/o/r/releases/tags/v1)
    [[ \${METADATA_FAIL:-0} == 0 ]] || exit 22
    printf '%s' '{"assets":[{"id":99,"name":"other.zip"},{"id":42,"name":"asset.zip"}]}' >"$out" ;;
  https://api.github.com/repos/o/r/releases/assets/42)
    [[ \${API_FAIL:-0} == 0 ]] || { echo "untrusted diagnostic $GH_TOKEN" >&2; exit 22; }
    printf 'api bytes' >"$out" ;;
  *) exit 77 ;;
esac
`, { mode: 0o755 });
  return {
    dest, dir, calls: () => readFileSync(log, 'utf8'), headers: () => readFileSync(headers, 'utf8'),
    run: () => spawnSync('/bin/bash', [script, 'o/r', 'v1', 'asset.zip', dest], {
      encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '', PATH: `${dir}:${process.env.PATH}`, CALLS: log, HEADER_INPUT: headers, ...env },
    }),
  };
}

test('a successful web download replaces the destination without calling the API', (t) => {
  const f = fixture(t, { WEB_OK: '1' });
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(f.dest, 'utf8'), 'web bytes');
  assert.doesNotMatch(f.calls(), /api.github.com/);
});

for (const tokens of [{}, { GH_TOKEN: 'preferred-token', GITHUB_TOKEN: 'other-token' }, { GITHUB_TOKEN: 'job-token' }]) {
  test(`web failure falls back to the named API asset (${Object.keys(tokens).join(',') || 'anonymous'})`, (t) => {
    const f = fixture(t, tokens);
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(f.dest, 'utf8'), 'api bytes');
    const calls = f.calls().trim().split('\n');
    assert.equal(calls.length, 3);
    assert.match(calls[2], /Accept: application\/octet-stream/);
    assert.match(calls[2], /-fsSL/);
    const token = tokens.GH_TOKEN || tokens.GITHUB_TOKEN;
    if (token) {
      assert.ok(!f.calls().includes(token), "curl argv exposes the token");
      assert.equal(f.headers().split(`Authorization: Bearer ${token}`).length - 1, 2, "both API requests receive authentication on stdin");
      if (tokens.GH_TOKEN && tokens.GITHUB_TOKEN) assert.ok(!f.headers().includes(tokens.GITHUB_TOKEN));
      assert.ok(!(r.stdout + r.stderr).includes(token));
    } else assert.doesNotMatch(f.calls() + f.headers(), /Authorization/);
  });
}

for (const failure of ['API_FAIL', 'METADATA_FAIL']) {
  test(`${failure}: both routes failing preserve the destination and remove partial files, without leaking a token`, (t) => {
    const f = fixture(t, { [failure]: '1', GH_TOKEN: 'secret-token' });
    const r = f.run();
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /web.*failed/i);
    assert.match(r.stderr, /API.*failed/i);
    assert.ok(!(r.stdout + r.stderr + f.calls()).includes('secret-token'));
    assert.equal(readFileSync(f.dest, 'utf8'), 'old destination');
    assert.deepEqual(readdirSync(f.dir).sort(), ['asset.zip', 'calls', 'curl', 'headers']);
  });
}
