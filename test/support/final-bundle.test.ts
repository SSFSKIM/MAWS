// The final run's build bundle (e2e/support/final-bundle.ts and its reporter; gate-offload Decision Log 50), over
// scratch repositories shaped as ci-gate.sh pushes a gate (an empty wrapper commit carrying the trailers, on
// `ci/<label>-<short>`) and checked out as the workflow's checkout does (one commit deep), a scratch out/ and a scratch
// build cache shaped as scripts/e2e-build.sh stores one. No build, no network: the origin is a local bare repository.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullConfig, FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinalBundleReporter, { finalBundleOption } from '../../e2e/support/final-bundle-reporter';
import { cacheDigest, inventory, NotFinalRun, parseCommit, trailer, writeFinalBundle, type BundleManifest, type FinalBundleRequest } from '../../e2e/support/final-bundle';
import { isolatedGitEnv } from './git-env';

let scratch: string;
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: isolatedGitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

interface Gate {
  checkout: string;
  cache: string;
  source: string;
  wrapper: string;
  ref: string;
  request(over?: Partial<FinalBundleRequest>, env?: Record<string, string | undefined>): FinalBundleRequest;
}

// A source commit, ci-gate.sh's wrapper over it (or a variation), pushed to a bare origin and cloned one commit deep;
// out/ built in the checkout and stored in the cache under the wrapper's sha, as the Mac lane's build cache keys it.
function gate({ message = 'ci-gate: x\n\nNonce: 1\nGates: e2e:connectors\nEvidence: yes', label = 'h-final', twoParents = false, otherTree = false } = {}): Gate {
  const source = join(scratch, 'source');
  mkdirSync(source);
  sh(source, 'init', '-q', '-b', 'main');
  writeFileSync(join(source, 'package.json'), '{"name":"fixture"}\n');
  sh(source, 'add', '-A');
  sh(source, 'commit', '-qm', 'source');
  const head = sh(source, 'rev-parse', 'HEAD');
  let tree = sh(source, 'rev-parse', 'HEAD^{tree}');
  if (otherTree) {
    writeFileSync(join(source, 'extra.txt'), 'not in the source\n');
    sh(source, 'add', '-A');
    tree = sh(source, 'write-tree');
  }
  const parents = ['-p', head];
  if (twoParents) {
    sh(source, 'commit', '-qm', 'side', '--allow-empty');
    parents.push('-p', sh(source, 'rev-parse', 'HEAD'));
  }
  const [title, ...rest] = message.split('\n\n');
  const wrapper = sh(source, 'commit-tree', tree, ...parents, '-m', title!, ...(rest.length > 0 ? ['-m', rest.join('\n\n')] : []));
  const ref = `ci/${label}-${head.slice(0, 8)}`;
  const origin = join(scratch, 'origin.git');
  sh(scratch, 'init', '-q', '--bare', origin);
  sh(source, 'push', '-q', origin, `${wrapper}:refs/heads/${ref}`);
  const checkout = join(scratch, 'checkout');
  sh(scratch, 'clone', '-q', '--depth=1', '--branch', ref, `file://${origin}`, checkout);

  const out = join(checkout, 'out');
  mkdirSync(join(out, 'main'), { recursive: true });
  mkdirSync(join(out, 'renderer'), { recursive: true });
  writeFileSync(join(out, 'main', 'index.js'), 'console.log(1)\n');
  writeFileSync(join(out, 'renderer', 'index.html'), '<!doctype html>\n');
  writeFileSync(join(out, 'renderer', 'B.css'), 'B');
  const cache = join(scratch, 'cache');
  const entry = join(cache, wrapper, 'plain');
  mkdirSync(entry, { recursive: true });
  cpSync(out, join(entry, 'out'), { recursive: true });
  writeFileSync(join(entry, 'digest'), `${cacheDigest(inventory(out))}\n`);
  return {
    checkout,
    cache,
    source: head,
    wrapper,
    ref,
    request: (over = {}, env = {}) => ({
      label: 'h-final',
      variant: 'plain',
      root: checkout,
      bundleDir: join(checkout, 'test-results', 'bundle'),
      env: { CI: 'true', GITHUB_SHA: wrapper, GITHUB_REF_NAME: ref, MAWS_E2E_BUILD_CACHE: cache, MAWS_E2E_BUILD_KEY: wrapper, ...env },
      platform: 'darwin',
      log: () => {},
      ...over,
    }),
  };
}

const bundleOf = (g: Gate) => join(g.checkout, 'test-results', 'bundle');

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-final-bundle-'));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe('the pieces', () => {
  it('reads a commit object’s tree, parents and message, and its last trailer as gate-plan.mjs does', () => {
    const raw = 'tree t1\nparent p1\nparent p2\nauthor a\n\nci-gate: x\n\nEvidence: no\nevidence: Yes\n';
    expect(parseCommit(raw)).toEqual({ tree: 't1', parents: ['p1', 'p2'], message: 'ci-gate: x\n\nEvidence: no\nevidence: Yes\n' });
    expect(trailer(parseCommit(raw).message, 'Evidence')).toBe('Yes');
    expect(trailer('ci-gate: x', 'Evidence')).toBeUndefined();
  });

  it('lists out/ byte-sorted, and digests it exactly as scripts/e2e-build.sh does', () => {
    const out = join(scratch, 'out');
    mkdirSync(join(out, 'main'), { recursive: true });
    mkdirSync(join(out, 'renderer'), { recursive: true });
    writeFileSync(join(out, 'main', 'index.js'), 'console.log(1)\n');
    writeFileSync(join(out, 'renderer', 'index.html'), '<!doctype html>\n');
    writeFileSync(join(out, 'renderer', 'B.css'), 'B');
    const files = inventory(out);
    expect(files.map((f) => f.path)).toEqual(['out/main/index.js', 'out/renderer/B.css', 'out/renderer/index.html']);
    expect(files[0]).toEqual({ path: 'out/main/index.js', bytes: 15, sha256: '3879a5d930ae1999b278a3a498f7de3fd83ba8dae59330fcfa2db31c103ac21d' });
    // `(cd out && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256) | shasum -a 256` over this tree
    expect(cacheDigest(files)).toBe('139dd877c176b40f39506da8197827b1c4aeb1b365eeed024799c015b22034ac');
  });

  it('refuses an out/ holding anything but files and directories', () => {
    const out = join(scratch, 'out');
    mkdirSync(out);
    symlinkSync('/etc/hosts', join(out, 'link'));
    expect(() => inventory(out)).toThrow('out/link is not a regular file or a directory');
  });
});

describe('the final bundle', () => {
  it('on the reserved final gate: fetches the shallow checkout’s parent, proves the trees and the cache, and writes the archive and its manifest', () => {
    const g = gate();
    expect(() => sh(g.checkout, 'cat-file', '-e', `${g.source}^{commit}`), 'the checkout is one commit deep').toThrow();
    const lines: string[] = [];
    const manifest = writeFinalBundle(g.request({ log: (line) => lines.push(line) }));
    expect(lines[0]).toContain(`fetching the parent ${g.source}`);
    const written = JSON.parse(readFileSync(join(bundleOf(g), 'manifest.json'), 'utf8')) as BundleManifest;
    expect(written).toEqual(manifest);
    expect(Object.keys(written)).toEqual(['commit', 'buildCommit', 'variant', 'tgz', 'sha256', 'files']);
    expect(written).toMatchObject({ commit: g.source, buildCommit: g.wrapper, variant: 'plain', tgz: 'plain.tgz' });
    expect(written.files).toEqual(inventory(join(g.checkout, 'out')));
    const archive = readFileSync(join(bundleOf(g), 'plain.tgz'));
    expect(written.sha256).toBe(execFileSync('node', ['-e', 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))', join(bundleOf(g), 'plain.tgz')], { encoding: 'utf8' }));
    expect(archive.length).toBeGreaterThan(0);
    // extracted elsewhere, the archive is out/ file for file
    const extracted = join(scratch, 'extracted');
    mkdirSync(extracted);
    execFileSync('tar', ['-xzf', join(bundleOf(g), 'plain.tgz'), '-C', extracted]);
    expect(inventory(join(extracted, 'out'))).toEqual(written.files);
  });

  it.each([
    ['a development label', { GITHUB_REF_NAME: 'ci/h-dev-0123abcd' }],
    ['no ref', { GITHUB_REF_NAME: undefined }],
    ['another child’s final label', { GITHUB_REF_NAME: 'ci/e1-final-0123abcd' }],
  ] as const)('is not this run’s on %s: nothing written, nothing proven', (_name, env) => {
    const g = gate();
    const request = g.request({}, env);
    expect(() => writeFinalBundle(request)).toThrow(NotFinalRun);
    expect(existsSync(bundleOf(g))).toBe(false);
  });

  // Decision Log 50 (amended 19:57Z): the reserved ref alone selects the final run; its other preconditions fail it
  it.each([
    ['off CI', { CI: undefined }, 'darwin', 'runs off CI'],
    ['CI=false', { CI: 'false' }, 'darwin', 'runs off CI'],
    ['Linux', {}, 'linux', 'runs on linux, not macOS'],
  ] as const)('refuses the reserved ref %s, as a failure rather than a pass without a bundle', (_name, env, platform, words) => {
    const g = gate();
    const attempt = () => writeFinalBundle(g.request({ platform }, env));
    expect(attempt).toThrow(words);
    expect(attempt).not.toThrow(NotFinalRun);
    expect(existsSync(bundleOf(g))).toBe(false);
  });

  it.each([
    ['HEAD is not GITHUB_SHA', (g: Gate) => g.request({}, { GITHUB_SHA: g.source }), 'is not GITHUB_SHA'],
    ['HEAD is not the build cache’s key', (g: Gate) => g.request({}, { MAWS_E2E_BUILD_KEY: g.source }), 'is not the build cache\'s key'],
    ['no cache', (g: Gate) => g.request({}, { MAWS_E2E_BUILD_CACHE: undefined }), 'MAWS_E2E_BUILD_CACHE is unset'],
    ['the ref names another source', (g: Gate) => g.request({}, { GITHUB_REF_NAME: 'ci/h-final-0123abcd' }), 'does not name the parent'],
    ['the cache holds the other variant only', (g: Gate) => g.request({ variant: 'harness' }), 'no such file'],
  ])('refuses when %s', (_name, request, words) => {
    const g = gate();
    expect(() => writeFinalBundle(request(g))).toThrow(words);
    expect(existsSync(join(bundleOf(g), 'manifest.json'))).toBe(false);
  });

  it('refuses a wrapper without the Evidence trailer', () => {
    const g = gate({ message: 'ci-gate: x\n\nNonce: 1\nGates: e2e:connectors' });
    expect(() => writeFinalBundle(g.request())).toThrow('has no "Evidence: yes" trailer');
  });

  it('refuses a wrapper with two parents', () => {
    const g = gate({ twoParents: true });
    expect(() => writeFinalBundle(g.request())).toThrow('has 2 parents');
  });

  it('refuses a wrapper whose tree is not its parent’s', () => {
    const g = gate({ otherTree: true });
    expect(() => writeFinalBundle(g.request())).toThrow('is not its parent\'s');
  });

  it('refuses an out/ that differs from the cached build by one file', () => {
    const g = gate();
    writeFileSync(join(g.checkout, 'out', 'main', 'index.js'), 'console.log(2)\n');
    expect(() => writeFinalBundle(g.request())).toThrow('is not the cache\'s plain build');
    expect(existsSync(join(bundleOf(g), 'manifest.json'))).toBe(false);
  });

  it('refuses a cache whose stored digest is not its out/', () => {
    const g = gate();
    writeFileSync(join(g.cache, g.wrapper, 'plain', 'digest'), `${'0'.repeat(64)}\n`);
    expect(() => writeFinalBundle(g.request())).toThrow('does not match the digest the cache stored');
  });
});

// The reporter as Playwright drives it: begun on the checkout's config, its tests ended, its run ended; the real bundle
// writer over the scratch gate, with the job's environment and platform stubbed.
describe('the reporter', () => {
  const ended = (reporter: FinalBundleReporter, statuses: TestResult['status'][]) =>
    statuses.forEach((status, k) => reporter.onTestEnd({ title: `case ${k}`, retries: 0 } as TestCase, { status, retry: 0 } as TestResult));
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let logs: ReturnType<typeof vi.spyOn>;
  let errors: ReturnType<typeof vi.spyOn>;

  function reporterOn(g: Gate, env: Record<string, string | undefined> = {}, on: NodeJS.Platform = 'darwin') {
    for (const [key, value] of Object.entries(g.request({}, env).env)) vi.stubEnv(key, value);
    Object.defineProperty(process, 'platform', { ...platform, value: on });
    const reporter = new FinalBundleReporter({ label: 'h-final', variant: 'plain' });
    reporter.onBegin({ configFile: join(g.checkout, 'playwright.config.ts'), projects: [{ outputDir: join(g.checkout, 'test-results') }] } as unknown as FullConfig);
    return reporter;
  }
  beforeEach(() => {
    logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reads MAWS_E2E_FINAL_BUNDLE as <label>:<variant>', () => {
    expect(finalBundleOption(undefined)).toBeNull();
    expect(finalBundleOption('h-final:plain')).toEqual({ label: 'h-final', variant: 'plain' });
    expect(() => finalBundleOption('h-final')).toThrow('<label>:plain or <label>:harness');
    expect(() => finalBundleOption('ci/x:plain')).toThrow();
  });

  it('on the reserved ref, writes the bundle after a whole passing invocation and leaves the run passed', async () => {
    const g = gate();
    const reporter = reporterOn(g);
    ended(reporter, ['passed', 'passed']);
    expect(await reporter.onEnd({ status: 'passed' } as FullResult)).toBeUndefined();
    expect(JSON.parse(readFileSync(join(bundleOf(g), 'manifest.json'), 'utf8'))).toMatchObject({ commit: g.source, buildCommit: g.wrapper, variant: 'plain' });
    expect(errors).not.toHaveBeenCalled();
  });

  it.each([
    ['a skipped test', ['passed', 'skipped'], {}, 'darwin', 'not every test passed: case 1: skipped'],
    ['no test', [], {}, 'darwin', 'no test ran'],
    ['CI unset', ['passed'], { CI: undefined }, 'darwin', 'runs off CI'],
    ['CI=false', ['passed'], { CI: 'false' }, 'darwin', 'runs off CI'],
    ['Linux', ['passed'], {}, 'linux', 'not macOS'],
    ['HEAD not GITHUB_SHA', ['passed'], { GITHUB_SHA: '0'.repeat(40) }, 'darwin', 'is not GITHUB_SHA'],
  ] as const)('on the reserved ref, fails an otherwise-passing invocation with %s, writing no bundle', async (_name, statuses, env, on, words) => {
    const g = gate();
    const reporter = reporterOn(g, env, on);
    ended(reporter, [...statuses]);
    expect(await reporter.onEnd({ status: 'passed' } as FullResult)).toEqual({ status: 'failed' });
    expect(existsSync(bundleOf(g))).toBe(false);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(words));
  });

  it('on the reserved ref, fails a wrapper with no Evidence trailer, writing no bundle', async () => {
    const g = gate({ message: 'ci-gate: x\n\nNonce: 1' });
    const reporter = reporterOn(g);
    ended(reporter, ['passed']);
    expect(await reporter.onEnd({ status: 'passed' } as FullResult)).toEqual({ status: 'failed' });
    expect(existsSync(bundleOf(g))).toBe(false);
  });

  it('on the reserved ref, leaves an already failed run failed, with no bundle', async () => {
    const g = gate();
    const reporter = reporterOn(g);
    ended(reporter, ['passed', 'failed']);
    expect(await reporter.onEnd({ status: 'failed' } as FullResult)).toBeUndefined();
    expect(existsSync(bundleOf(g))).toBe(false);
  });

  it.each([
    ['passing', ['passed'], 'passed'],
    ['with a skipped test', ['passed', 'skipped'], 'passed'],
    ['failed', ['failed'], 'failed'],
  ] as const)('on any other ref, a %s run is as it was: no bundle, no status change', async (_name, statuses, status) => {
    const g = gate();
    const reporter = reporterOn(g, { GITHUB_REF_NAME: `ci/h-dev-${g.source.slice(0, 8)}` });
    ended(reporter, [...statuses]);
    expect(await reporter.onEnd({ status } as FullResult)).toBeUndefined();
    expect(existsSync(bundleOf(g))).toBe(false);
    expect(errors).not.toHaveBeenCalled();
    expect(logs).toHaveBeenCalledWith(expect.stringContaining('not written'));
  });
});
