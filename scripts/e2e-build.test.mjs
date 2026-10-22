// node --test scripts/e2e-build.test.mjs (from anywhere; no install needed). scripts/e2e-build.sh's cache, above all its
// MAWS_E2E_BUILD_REQUIRE=1 mode, in which a guest-eligible e2e job restores the out/ the pool's e2e-build job built and
// never builds (ci-kit's mac-lane concurrency spec, Decision Log "out/ is built on the pool"). Each case runs a copy of
// the script in a scratch directory shaped as the checkout, whose node_modules/.bin/electron-vite is a fake that records
// each call and writes an out/ of its variant.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, test } from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./e2e-build.sh', import.meta.url));
const key = '0123abcd0123abcd0123abcd0123abcd0123abcd';
let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-e2e-build-'));
  mkdirSync(join(dir, 'scripts'));
  cpSync(script, join(dir, 'scripts/e2e-build.sh'));
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
  const fake = join(dir, 'node_modules/.bin/electron-vite');
  writeFileSync(fake, '#!/usr/bin/env bash\necho "$*" >>calls\nrm -rf out\nmkdir -p out/main out/renderer\necho "harness=$MAWS_HARNESS" >out/main/index.js\necho "<!doctype html>" >out/renderer/index.html\n');
  chmodSync(fake, 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const build = (variant, env = {}) => {
  const result = spawnSync('bash', [join(dir, 'scripts/e2e-build.sh'), variant], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  return { ...result, built: existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8').split('\n').filter(Boolean).length : 0 };
};
const cache = () => join(dir, 'cache');
const entry = (variant) => join(cache(), key, variant);
const outFile = () => readFileSync(join(dir, 'out/main/index.js'), 'utf8');
const cached = (extra = {}) => ({ MAWS_E2E_BUILD_CACHE: cache(), MAWS_E2E_BUILD_KEY: key, ...extra });
const required = (extra = {}) => cached({ MAWS_E2E_BUILD_REQUIRE: '1', ...extra });

// An entry as the pool's e2e-build job stores it: the script's own build-and-store, then the fake's call log and the
// checkout's out/ cleared, as a fresh job on another machine finds them.
const stored = (variant) => {
  assert.equal(build(variant, cached()).status, 0);
  rmSync(join(dir, 'calls'));
  rmSync(join(dir, 'out'), { recursive: true });
};

test('without a cache, and with one, the script builds as it always did: a missing entry is built and stored, a stored one restored', () => {
  assert.equal(build('harness').status, 0);
  assert.equal(outFile(), 'harness=1\n');
  const stored = build('plain', cached());
  assert.equal(stored.status, 0);
  assert.match(stored.stdout, /^e2e-build: out\/ \(plain\) built and stored in /m);
  assert.ok(existsSync(join(entry('plain'), 'digest')));
  rmSync(join(dir, 'out'), { recursive: true });
  const restored = build('plain', cached());
  assert.equal(restored.status, 0);
  assert.match(restored.stdout, /^e2e-build: out\/ \(plain\) restored from /);
  assert.equal(restored.built, 2);
  assert.equal(outFile(), 'harness=0\n');
  // REQUIRE at any value but 1 is off.
  assert.equal(build('harness', cached({ MAWS_E2E_BUILD_REQUIRE: '0' })).built, 3);
});

test('under REQUIRE a stored entry is restored and nothing builds', () => {
  stored('plain');
  const { status, stdout, built } = build('plain', required());
  assert.equal(status, 0);
  assert.equal(built, 0);
  assert.equal(outFile(), 'harness=0\n');
  assert.match(stdout, new RegExp(`^e2e-build: out/ \\(plain\\) restored from ${entry('plain')}, sha256 [0-9a-f]{64}\\n$`));
});

test('under REQUIRE a missing entry fails, naming the key, the variant and the entry, and nothing builds', () => {
  stored('plain');
  const { status, stderr, built } = build('harness', required());
  assert.equal(status, 1);
  assert.equal(built, 0);
  assert.ok(stderr.includes(`no stored build for key ${key}, variant harness`), stderr);
  assert.ok(stderr.includes(entry('harness')), stderr);
  assert.equal(existsSync(join(dir, 'out')), false);
});

test('under REQUIRE an entry that does not match its digest fails, naming the key, the variant and the entry, and nothing builds', () => {
  stored('harness');
  writeFileSync(join(entry('harness'), 'out/main/index.js'), 'tampered\n');
  const { status, stderr, built } = build('harness', required());
  assert.equal(status, 1);
  assert.equal(built, 0);
  assert.ok(stderr.includes(`the stored build for key ${key}, variant harness, at ${entry('harness')}, does not match its digest`), stderr);
  // The restored copy is not left behind for anything to run against; the entry stays for a look.
  assert.equal(existsSync(join(dir, 'out')), false);
  assert.ok(existsSync(join(entry('harness'), 'digest')));
});

test('under REQUIRE without a cache or a key the script fails and nothing builds', () => {
  for (const env of [{ MAWS_E2E_BUILD_REQUIRE: '1' }, required({ MAWS_E2E_BUILD_CACHE: '' }), required({ MAWS_E2E_BUILD_KEY: '' })]) {
    const { status, stderr, built } = build('plain', env);
    assert.equal(status, 1, JSON.stringify(env));
    assert.equal(built, 0, JSON.stringify(env));
    assert.match(stderr, /^e2e-build: MAWS_E2E_BUILD_REQUIRE=1 needs MAWS_E2E_BUILD_CACHE and MAWS_E2E_BUILD_KEY/, JSON.stringify(env));
  }
});
