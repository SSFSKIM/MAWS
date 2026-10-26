// node --test .github/scripts/maws-app-scan.test.mjs (from anywhere; needs git, tar, python3, curl and the network to
// github.com for the pinned gitleaks). maws-app-scan.sh, the secret scan a push to SSFSKIM/maws-app passes first (ci-kit's
// docs/doperpowers/specs/2026-10-26-maws-hosted-mac-design.md, The secret scan): a planted credential is found and named
// without its value, this checkout's filtered tree is clean under .github/maws-app/gitleaks.toml, and a scanner that
// cannot be had refuses. The planted values are made here at run time, so this file holds none for the scan to find.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scan = join(root, '.github/scripts/maws-app-scan.sh');
const filter = join(root, '.github/scripts/maws-app-tree.sh');

// One download of the pinned gitleaks for the whole file.
const cache = mkdtempSync(join(tmpdir(), 'maws-app-scan-cache-'));
test.after(() => rmSync(cache, { recursive: true, force: true }));

function scratch(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A `gitleaks` on PATH that is not the pinned release, which the script must not use.
function strayGitleaks(t) {
  const bin = scratch(t, 'maws-app-scan-bin-');
  writeFileSync(join(bin, 'gitleaks'), '#!/bin/sh\necho 8.0.0\nexit 0\n');
  chmodSync(join(bin, 'gitleaks'), 0o755);
  return bin;
}

const scanned = (dir, env = {}) =>
  spawnSync('bash', [scan, dir], { encoding: 'utf8', env: { ...process.env, MAWS_APP_GITLEAKS_CACHE: cache, ...env } });

const alnum = (n, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') =>
  [...randomBytes(n)].map((b) => alphabet[b % alphabet.length]).join('');

test('a planted GitHub token, AWS key and private key are found, each named by file, line and rule, never by value', (t) => {
  const dir = scratch(t, 'maws-app-scan-planted-');
  const github = ['gh', 'p_', alnum(36)].join('');
  const aws = ['AK', 'IA', alnum(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')].join('');
  const block = ['RSA', 'PRIVATE', 'KEY'].join(' ');
  const pem = [`-----BEGIN ${block}-----`, ...Array.from({ length: 6 }, () => alnum(64)), `-----END ${block}-----`, ''].join('\n');
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  put('src/config.ts', `export const config = {\n  region: 'us-east-1',\n  token: '${github}',\n};\n`);
  put('deploy/env.sh', `#!/bin/sh\nexport AWS_ACCESS_KEY_ID=${aws}\n`);
  put('keys/deploy.pem', pem);
  put('README.md', '# nothing here\n');

  const r = scanned(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = r.stdout + r.stderr;
  assert.match(out, /src\/config\.ts:3 github-pat/);
  assert.match(out, /deploy\/env\.sh:2 aws-access-token/);
  assert.match(out, /keys\/deploy\.pem:1 private-key/);
  assert.doesNotMatch(out, /README\.md/);
  for (const value of [github, aws, ...pem.split('\n').slice(1, 7)]) assert.ok(!out.includes(value), 'a value was printed');
});

test('a directory with no credential is clean', (t) => {
  const dir = scratch(t, 'maws-app-scan-clean-');
  writeFileSync(join(dir, 'index.ts'), "export const greeting = 'hello';\n");
  const r = scanned(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /maws-app-scan: clean/);
});

test("HEAD's filtered tree, the tree a request of this commit publishes, scans clean", (t) => {
  const gitDir = spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const out = join(scratch(t, 'maws-app-scan-head-'), 'tree');
  const exported = spawnSync('bash', [filter, gitDir, 'HEAD', out], { encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);
  const r = scanned(out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a scanner that cannot be downloaded refuses, as a finding does', (t) => {
  const dir = scratch(t, 'maws-app-scan-nodl-');
  writeFileSync(join(dir, 'index.ts'), 'export {};\n');
  const r = scanned(dir, {
    MAWS_APP_GITLEAKS_CACHE: scratch(t, 'maws-app-scan-empty-cache-'),
    MAWS_APP_GITLEAKS_URL: 'http://127.0.0.1:9',
    PATH: `${strayGitleaks(t)}:${process.env.PATH}`,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /could not download gitleaks/);
  assert.match(r.stdout, /maws-app-scan: refused/);
});

test('a scanner whose archive fails its checksum refuses', (t) => {
  const dir = scratch(t, 'maws-app-scan-badsum-');
  writeFileSync(join(dir, 'index.ts'), 'export {};\n');
  const mirror = scratch(t, 'maws-app-scan-mirror-');
  const version = /^GITLEAKS_VERSION=(\S+)$/m.exec(readFileSync(scan, 'utf8'))[1];
  mkdirSync(join(mirror, `v${version}`));
  for (const asset of ['linux_x64', 'linux_arm64', 'darwin_arm64', 'darwin_x64']) {
    writeFileSync(join(mirror, `v${version}`, `gitleaks_${version}_${asset}.tar.gz`), 'not the release');
  }
  const r = scanned(dir, {
    MAWS_APP_GITLEAKS_CACHE: scratch(t, 'maws-app-scan-empty-cache-'),
    MAWS_APP_GITLEAKS_URL: `file://${mirror}`,
    PATH: `${strayGitleaks(t)}:${process.env.PATH}`,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /checksum/);
  assert.match(r.stdout, /maws-app-scan: refused/);
});
