// node --test scripts/provision-engine.test.mjs (from anywhere; no install needed). scripts/provision-engine.sh, the Mac
// lane's provisioning of the Discover group's engine (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M1):
// a download verified against the committed checksum, cached by version, its --version checked, MAWS_E2E_ENGINE_BIN
// exported. Each case serves a fake release from a scratch directory through curl's file:// scheme, under its own
// checksum file, platform and cache, so nothing reaches the network or the runner's cache.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, test } from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./provision-engine.sh', import.meta.url));
let dir;
const releases = () => join(dir, 'releases');
const cache = () => join(dir, 'cache');
const checksums = () => join(dir, 'checksums.txt');

// A release of `version` whose binary answers `reports` to --version.
function release(version, reports = version) {
  const file = join(releases(), version, 'test-platform', 'claude');
  mkdirSync(join(releases(), version, 'test-platform'), { recursive: true });
  writeFileSync(file, `#!/bin/sh\necho "${reports} (Claude Code)"\n`);
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
const pin = (lines) => writeFileSync(checksums(), `# version platform sha256\n${lines.join('\n')}\n`);
const provision = (version, env = {}) =>
  spawnSync('bash', [script, version], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: dir, MAWS_ENGINE_DOWNLOAD_BASE: `file://${releases()}`, MAWS_ENGINE_CHECKSUMS: checksums(), MAWS_ENGINE_CACHE: cache(), MAWS_ENGINE_PLATFORM: 'test-platform', ...env },
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-provision-engine-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('a clean cache downloads the pinned build, verifies it, caches it by version and exports its path', () => {
  pin([`2.1.309 test-platform ${release('2.1.309')}`]);
  const githubEnv = join(dir, 'github-env');
  const run = provision('2.1.309', { GITHUB_ENV: githubEnv });
  assert.equal(run.status, 0, run.stderr);
  const bin = join(cache(), '2.1.309', 'claude');
  assert.equal(run.stdout, `export MAWS_E2E_ENGINE_BIN=${bin}\n`);
  assert.equal(readFileSync(githubEnv, 'utf8'), `MAWS_E2E_ENGINE_BIN=${bin}\n`);
  assert.equal(statSync(bin).mode & 0o111, 0o111);
  assert.match(run.stderr, /downloaded/);
});

test('a cached build that still matches its checksum is used without a download', () => {
  pin([`2.1.309 test-platform ${release('2.1.309')}`]);
  assert.equal(provision('2.1.309').status, 0);
  rmSync(releases(), { recursive: true });
  const again = provision('2.1.309');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stderr, /cached/);
});

test('a download whose checksum differs stops the job with the checksum it saw, and caches nothing', () => {
  const real = release('2.1.309');
  pin([`2.1.309 test-platform ${'0'.repeat(64)}`]);
  const run = provision('2.1.309');
  assert.notEqual(run.status, 0);
  assert.ok(run.stderr.includes(real), run.stderr);
  assert.ok(run.stderr.includes('0'.repeat(64)), run.stderr);
  assert.equal(run.stdout, '');
  assert.equal(existsSync(join(cache(), '2.1.309', 'claude')), false);
});

test('a version or platform the checksum file does not pin is refused before any download', () => {
  pin([`2.1.309 other-platform ${release('2.1.309')}`]);
  const run = provision('2.1.309');
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /no checksum for 2\.1\.309 test-platform/);
});

test('a build that reports another version fails after its checksum', () => {
  pin([`2.1.309 test-platform ${release('2.1.309', '2.1.310')}`]);
  const run = provision('2.1.309');
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /reports 2\.1\.310/);
  assert.equal(run.stdout, '');
});

test('the committed checksums pin 2.1.309 for the Mac lane', () => {
  const committed = readFileSync(fileURLToPath(new URL('./engine-checksums.txt', import.meta.url)), 'utf8');
  assert.match(committed, /^2\.1\.309 darwin-arm64 5eadc0009cdcdbc0d06e58110d7b2baf88ced6088b1c33a60a21217fe410619c$/m);
});
