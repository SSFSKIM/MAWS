// The final run's build bundle and the one final reporter (e2e/support/final-bundle.ts, final-bundle-reporter.ts and the
// design and dashboard groups' configured reporters; gate-offload Decision Log 50; converged at P3-F, the tracker's
// reporter row), over scratch repositories shaped as ci-gate.sh pushes a gate (an empty wrapper commit `ci-gate: <short>`
// carrying the trailers, on `ci/<label>-<short>`) and checked out as the workflow's checkout does (one commit deep), a
// scratch out/ and a scratch build cache shaped as scripts/e2e-build.sh stores one. No build, no network: the origin is
// a local bare repository. The reporter is driven as Playwright drives it, its package scripts the repository's own.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_ACCEPTANCE } from '../../e2e/support/dashboard-acceptance';
import DashboardFinalReporter from '../../e2e/support/dashboard-final-reporter';
import DesignFinalReporter from '../../e2e/support/design-final-reporter';
import FinalBundleReporter, { finalBundleOption } from '../../e2e/support/final-bundle-reporter';
import { cacheDigest, inventory, NotFinalRun, parseCommit, selectedRef, writeFinalBundle, type BundleManifest, type FinalBundleRequest } from '../../e2e/support/final-bundle';
import { playwrightArgs } from '../../e2e/support/final-invocation';
import { isolatedGitEnv } from './git-env';

const SCRIPTS = (JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
let scratch: string;
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: isolatedGitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

interface Gate {
  checkout: string;
  origin: string;
  cache: string;
  source: string;
  wrapper: string;
  short: string;
  request(over?: Partial<FinalBundleRequest>, env?: Record<string, string | undefined>): FinalBundleRequest;
}

// A source commit (the repository's acceptance scripts in its package.json), ci-gate.sh's wrapper over it (or a
// variation), pushed to a bare origin and cloned one commit deep; out/ built in the checkout and stored in the cache under
// the wrapper's sha, as the Mac lane's build cache keys it. `message` takes `<short>` for the parent's short sha.
function gate({ message = 'ci-gate: <short>\n\nNonce: 1\nGates: e2e:connectors\nEvidence: yes', label = 'h-final', twoParents = false, otherTree = false } = {}): Gate {
  const source = join(scratch, 'source');
  mkdirSync(source);
  sh(source, 'init', '-q', '-b', 'main');
  writeFileSync(join(source, 'package.json'), `${JSON.stringify({ name: 'fixture', scripts: SCRIPTS }, null, 2)}\n`);
  sh(source, 'add', '-A');
  sh(source, 'commit', '-qm', 'source');
  const head = sh(source, 'rev-parse', 'HEAD');
  const short = head.slice(0, 8);
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
  const [title, ...rest] = message.replaceAll('<short>', short).split('\n\n');
  const wrapper = sh(source, 'commit-tree', tree, ...parents, '-m', title!, ...rest.flatMap((paragraph) => ['-m', paragraph]));
  const ref = `ci/${label}-${short}`;
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
    origin,
    cache,
    source: head,
    wrapper,
    short,
    request: (over = {}, env = {}) => ({
      labels: [label],
      variant: 'plain',
      root: checkout,
      bundleDir: join(checkout, 'test-results', 'bundle'),
      env: { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_SHA: wrapper, GITHUB_REF: `refs/heads/${ref}`, GITHUB_REF_NAME: ref, MAWS_E2E_BUILD_CACHE: cache, MAWS_E2E_BUILD_KEY: wrapper, ...env },
      platform: 'darwin',
      log: () => {},
      ...over,
    }),
  };
}

const bundleOf = (g: Gate) => join(g.checkout, 'test-results', 'bundle');
// nothing of a bundle, a staged one included, is left in test-results/
const noBundle = (g: Gate) => !existsSync(join(g.checkout, 'test-results')) || readdirSync(join(g.checkout, 'test-results')).length === 0;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-final-bundle-'));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe('the pieces', () => {
  it('reads a commit object’s tree, parents, subject and closing trailer block', () => {
    const raw = 'tree t1\nparent p1\nparent p2\nauthor a\n\nci-gate: 0123abcd\n\nNonce: 1\nEvidence: yes\n';
    expect(parseCommit(raw)).toEqual({ tree: 't1', parents: ['p1', 'p2'], subject: 'ci-gate: 0123abcd', trailers: ['Nonce: 1', 'Evidence: yes'] });
    expect(parseCommit('tree t1\n\nci-gate: x\n\nEvidence: yes\nmore words here\n').trailers).toEqual([]); // not a trailer block
    expect(parseCommit('tree t1\n\nEvidence: yes\n').trailers).toEqual([]); // the subject is no trailer block
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

  it('refuses an out/ holding anything but files and directories, or a name the digest cannot carry', () => {
    const out = join(scratch, 'out');
    mkdirSync(out);
    symlinkSync('/etc/hosts', join(out, 'link'));
    expect(() => inventory(out)).toThrow('out/link is not a regular file or a directory');
    rmSync(join(out, 'link'));
    writeFileSync(join(out, 'a\\b'), 'x');
    expect(() => inventory(out)).toThrow('a name the digest cannot carry');
  });
});

describe('selection', () => {
  it('is a reserved label’s ref, by its whole `ci/<label>-` prefix, from GITHUB_REF or GITHUB_REF_NAME', () => {
    expect(selectedRef(['e2-final', 'p3f-final'], { GITHUB_REF: 'refs/heads/ci/p3f-final-0123abcd' })).toEqual({ label: 'p3f-final', ref: 'ci/p3f-final-0123abcd' });
    expect(selectedRef(['e2-final'], { GITHUB_REF_NAME: 'ci/e2-final-0123abcd' })).toEqual({ label: 'e2-final', ref: 'ci/e2-final-0123abcd' });
    expect(selectedRef(['e2-final'], { GITHUB_REF_NAME: 'ci/e2-final-anything' })).toEqual({ label: 'e2-final', ref: 'ci/e2-final-anything' }); // the prefix is not narrowed
    for (const ref of ['ci/e2-accept-mac-0123abcd', 'ci/e1-final-0123abcd', 'ci/xe2-final-0123abcd', 'main', '']) expect(selectedRef(['e2-final'], { GITHUB_REF_NAME: ref }), ref).toBeNull();
    expect(selectedRef(['e2-final'], {})).toBeNull();
    expect(() => selectedRef(['ci/x'], {})).toThrow('is not a ref name');
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
    expect(readdirSync(bundleOf(g)).sort()).toEqual(['manifest.json', 'plain.tgz']);
    expect(readdirSync(join(g.checkout, 'test-results'))).toEqual(['bundle']); // no staging left beside it
    expect(written.sha256).toBe(execFileSync('node', ['-e', 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))', join(bundleOf(g), 'plain.tgz')], { encoding: 'utf8' }));
    // extracted elsewhere, the archive is out/ file for file
    const extracted = join(scratch, 'extracted');
    mkdirSync(extracted);
    execFileSync('tar', ['-xzf', join(bundleOf(g), 'plain.tgz'), '-C', extracted]);
    expect(inventory(join(extracted, 'out'))).toEqual(written.files);
  });

  it('replaces an earlier bundle rather than adding to it', () => {
    const g = gate();
    mkdirSync(bundleOf(g), { recursive: true });
    writeFileSync(join(bundleOf(g), 'harness.tgz'), 'an earlier run’s');
    writeFinalBundle(g.request());
    expect(readdirSync(bundleOf(g)).sort()).toEqual(['manifest.json', 'plain.tgz']);
  });

  it('answers to any of its labels: P3-F’s hand-back label beside a child’s', () => {
    const g = gate({ label: 'p3f-final' });
    expect(writeFinalBundle(g.request({ labels: ['e2-final', 'p3f-final'] }))).toMatchObject({ commit: g.source, buildCommit: g.wrapper });
  });

  it.each([
    ['a development label', { GITHUB_REF: 'refs/heads/ci/h-dev-0123abcd', GITHUB_REF_NAME: 'ci/h-dev-0123abcd' }],
    ['no ref', { GITHUB_REF: undefined, GITHUB_REF_NAME: undefined }],
    ['another child’s final label', { GITHUB_REF: undefined, GITHUB_REF_NAME: 'ci/e1-final-0123abcd' }],
  ] as const)('is not this run’s on %s: nothing written, nothing proven', (_name, env) => {
    const g = gate();
    expect(() => writeFinalBundle(g.request({}, env))).toThrow(NotFinalRun);
    expect(noBundle(g)).toBe(true);
  });

  // Decision Log 50 (amended 19:57Z): the reserved ref alone selects the final run; its other preconditions fail it
  it.each([
    ['off CI', (g: Gate) => g.request({}, { CI: undefined }), 'runs off CI'],
    ['CI=false', (g: Gate) => g.request({}, { CI: 'false' }), 'runs off CI'],
    ['outside GitHub Actions', (g: Gate) => g.request({}, { GITHUB_ACTIONS: undefined }), 'GITHUB_ACTIONS=unset'],
    ['on Linux', (g: Gate) => g.request({ platform: 'linux' }), 'runs on linux, not macOS'],
    ['HEAD is not GITHUB_SHA', (g: Gate) => g.request({}, { GITHUB_SHA: g.source }), 'is not GITHUB_SHA'],
    ['HEAD is not the build cache’s key', (g: Gate) => g.request({}, { MAWS_E2E_BUILD_KEY: g.source }), "is not the build cache's key"],
    ['the ref names another source', (g: Gate) => g.request({}, { GITHUB_REF: undefined, GITHUB_REF_NAME: 'ci/h-final-0123abcd' }), 'does not name the parent'],
    ['the ref under the reserved prefix names no source', (g: Gate) => g.request({}, { GITHUB_REF: undefined, GITHUB_REF_NAME: 'ci/h-final-typo' }), 'does not name the parent'],
    ['no cache', (g: Gate) => g.request({}, { MAWS_E2E_BUILD_CACHE: undefined }), 'MAWS_E2E_BUILD_CACHE is unset'],
    ['the cache holds the other variant only', (g: Gate) => g.request({ variant: 'harness' }), 'no harness build in the cache'],
  ])('refuses the reserved ref %s, as a failure rather than a pass without a bundle', (_name, request, words) => {
    const g = gate();
    const attempt = () => writeFinalBundle(request(g));
    expect(attempt).toThrow(words);
    expect(attempt).not.toThrow(NotFinalRun);
    expect(noBundle(g)).toBe(true);
  });

  it.each([
    ['without the Evidence trailer', { message: 'ci-gate: <short>\n\nNonce: 1\nGates: e2e:connectors' }, 'has no "Evidence: yes" in its trailers'],
    ['with Evidence outside its trailer block', { message: 'ci-gate: <short>\n\nEvidence: yes\nmore words here' }, 'has no "Evidence: yes" in its trailers'],
    ['that is not ci-gate.sh’s (its subject)', { message: 'P3-F: a commit\n\nEvidence: yes' }, "is not ci-gate.sh's wrapper of its parent"],
    ['with two parents', { twoParents: true }, 'has 2 parents'],
    ['whose tree is not its parent’s', { otherTree: true }, "is not its parent's"],
  ])('refuses a wrapper %s', (_name, shape, words) => {
    const g = gate(shape);
    expect(() => writeFinalBundle(g.request())).toThrow(words);
    expect(noBundle(g)).toBe(true);
  });

  it('refuses a parent the shallow checkout lacks and the origin cannot give', () => {
    const g = gate();
    rmSync(g.origin, { recursive: true, force: true });
    expect(() => writeFinalBundle(g.request())).toThrow(`the parent ${g.source} could not be read or fetched`);
    expect(noBundle(g)).toBe(true);
  });

  it('refuses an out/ that differs from the cached build by one file, by the digest the cache stored', () => {
    const g = gate();
    writeFileSync(join(g.checkout, 'out', 'main', 'index.js'), 'console.log(2)\n');
    expect(() => writeFinalBundle(g.request())).toThrow('does not match the digest the cache stored');
    expect(noBundle(g)).toBe(true);
  });

  it('refuses a cache whose files are not the digest it stored, file by file', () => {
    const g = gate();
    writeFileSync(join(g.cache, g.wrapper, 'plain', 'out', 'stale.js'), 'old\n');
    writeFileSync(join(g.cache, g.wrapper, 'plain', 'out', 'main', 'index.js'), 'console.log(3)\n');
    expect(() => writeFinalBundle(g.request())).toThrow("out/ is not the cache's plain build: only in the cache: out/stale.js; changed: out/main/index.js");
    expect(noBundle(g)).toBe(true);
  });
});

// The reporter as Playwright drives it: begun on the checkout's config with the runner's command line and the root
// suite, its cases ended, its run ended; the real bundle writer over the scratch gate, with the job's environment and
// platform stubbed.
describe('the reporter', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let logs: ReturnType<typeof vi.spyOn>;
  let errors: ReturnType<typeof vi.spyOn>;
  const RUNNER = ['/usr/local/bin/node', '/repo/node_modules/@playwright/test/cli.js', 'test'];

  const caseIn = (file: string, k: number, outcome = 'expected') =>
    ({ location: { file: `/repo/e2e/${file}`, line: 1, column: 1 }, titlePath: () => ['', file, `case ${k}`], outcome: () => outcome }) as unknown as TestCase;

  interface Driven {
    argv?: readonly string[];
    cases?: readonly TestCase[];
    statuses?: readonly TestResult['status'][];
    forbidOnly?: boolean;
    configFile?: string;
  }
  // Stubs the job's environment on the gate (beside `env`), then begins, ends each case and ends the run.
  async function drive(g: Gate, reporter: FinalBundleReporter, script: string, d: Driven = {}, env: Record<string, string | undefined> = {}, result: FullResult['status'] = 'passed') {
    for (const [key, value] of Object.entries(g.request({}, env).env)) vi.stubEnv(key, value);
    const cases = d.cases ?? [caseIn('connectors.spec.ts', 0), caseIn('connectors.spec.ts', 1)];
    const config = {
      configFile: join(g.checkout, d.configFile ?? 'playwright.config.ts'),
      projects: [{ outputDir: join(g.checkout, 'test-results') }],
      argv: d.argv ?? [...RUNNER, ...playwrightArgs(SCRIPTS[script]!)!],
      grep: /.*/,
      grepInvert: null,
      shard: null,
      forbidOnly: d.forbidOnly ?? true,
    } as unknown as FullConfig;
    reporter.onBegin(config, { allTests: () => cases } as unknown as Suite);
    cases.forEach((test, k) => reporter.onTestEnd(test, { status: d.statuses?.[k] ?? 'passed', retry: 0 } as TestResult));
    return reporter.onEnd({ status: result } as FullResult);
  }
  const hReporter = () => new FinalBundleReporter({ labels: ['h-final'], variant: 'plain', script: 'e2e:connectors' });
  const said = () => [...logs.mock.calls, ...errors.mock.calls].map((call) => String(call[0])).join('\n');

  beforeEach(() => {
    logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', platform);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reads MAWS_E2E_FINAL_BUNDLE as <label>:<variant>', () => {
    expect(finalBundleOption(undefined)).toBeNull();
    expect(finalBundleOption('h-final:plain')).toEqual({ labels: ['h-final'], variant: 'plain' });
    expect(() => finalBundleOption('h-final')).toThrow('<label>:plain or <label>:harness');
    expect(() => finalBundleOption('ci/x:plain')).toThrow();
  });

  it('on the reserved ref, writes the bundle after the whole passing invocation of its script and leaves the run passed', async () => {
    const g = gate();
    expect(await drive(g, hReporter(), 'e2e:connectors')).toBeUndefined();
    expect(JSON.parse(readFileSync(join(bundleOf(g), 'manifest.json'), 'utf8'))).toMatchObject({ commit: g.source, buildCommit: g.wrapper, variant: 'plain' });
    expect(errors).not.toHaveBeenCalled();
  });

  it('takes the script pnpm runs when its group names none (the MAWS_E2E_FINAL_BUNDLE form), and refuses a run outside one', async () => {
    const g = gate();
    const reporter = () => new FinalBundleReporter(finalBundleOption('h-final:plain')!);
    expect(await drive(g, reporter(), 'e2e:connectors', {}, { npm_lifecycle_event: 'e2e:connectors' })).toBeUndefined();
    expect(existsSync(join(bundleOf(g), 'manifest.json'))).toBe(true);
    rmSync(join(g.checkout, 'test-results'), { recursive: true });
    expect(await drive(g, reporter(), 'e2e:connectors', {}, { npm_lifecycle_event: undefined })).toEqual({ status: 'failed' });
    expect(said()).toContain('not run through a package script');
    expect(noBundle(g)).toBe(true);
  });

  // the tracker's reporter row: narrowings the CLI applies outside FullConfig.grep, every case still passing
  it.each([
    ['a grep', ['--grep', 'oauth'], 'adds --grep oauth'],
    ['a grep inverse', ['--grep-invert', 'oauth'], 'adds --grep-invert oauth'],
    ['the last failures', ['--last-failed'], 'adds --last-failed'],
    ['a test list', ['--test-list=cases.txt'], 'adds --test-list=cases.txt'],
    ['a second file', ['e2e/connectors-direct.spec.ts'], 'adds e2e/connectors-direct.spec.ts'],
  ])('on the reserved ref, fails an invocation narrowed on the command line by %s, naming it, writing no bundle', async (_what, extra, words) => {
    const g = gate();
    expect(await drive(g, hReporter(), 'e2e:connectors', { argv: [...RUNNER, 'e2e/connectors.spec.ts', ...extra] })).toEqual({ status: 'failed' });
    expect(said()).toContain(`not the whole invocation of e2e:connectors: the invocation was narrowed: the command line ${words}`);
    expect(said()).not.toContain('runs off CI');
    expect(noBundle(g)).toBe(true);
  });

  it('on the reserved ref, fails a location in place of the script’s file', async () => {
    const g = gate();
    expect(await drive(g, hReporter(), 'e2e:connectors', { argv: [...RUNNER, 'e2e/connectors.spec.ts:40'] })).toEqual({ status: 'failed' });
    expect(said()).toContain('adds e2e/connectors.spec.ts:40');
    expect(noBundle(g)).toBe(true);
  });

  it.each([
    ['a skipped case', { statuses: ['passed', 'skipped'] as TestResult['status'][] }, {}, 'a skipped case: connectors.spec.ts › connectors.spec.ts › case 1'],
    ['no case', { cases: [] }, {}, 'no case ran'],
    ['test.only admitted', { forbidOnly: false }, {}, 'test.only admitted'],
    ['CI unset', {}, { CI: undefined }, 'runs off CI'],
    ['HEAD not GITHUB_SHA', {}, { GITHUB_SHA: '0'.repeat(40) }, 'is not GITHUB_SHA'],
  ] as const)('on the reserved ref, fails an otherwise-passing invocation with %s, writing no bundle', async (_name, d, env, words) => {
    const g = gate();
    expect(await drive(g, hReporter(), 'e2e:connectors', d, env)).toEqual({ status: 'failed' });
    expect(said()).toContain(words);
    expect(noBundle(g)).toBe(true);
  });

  it('on the reserved ref, fails on Linux, writing no bundle', async () => {
    const g = gate();
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    expect(await drive(g, hReporter(), 'e2e:connectors')).toEqual({ status: 'failed' });
    expect(said()).toContain('not macOS');
    expect(noBundle(g)).toBe(true);
  });

  it('on the reserved ref, leaves an already failed run failed, with no bundle', async () => {
    const g = gate();
    expect(await drive(g, hReporter(), 'e2e:connectors', { statuses: ['passed', 'failed'] }, {}, 'failed')).toBeUndefined();
    expect(noBundle(g)).toBe(true);
  });

  it.each([
    ['passing', [] as string[], 'passed'],
    ['narrowed on the command line', ['--grep', 'oauth'], 'passed'],
    ['failed', [], 'failed'],
  ] as const)('on any other ref, a %s run is as it was: no bundle, no status change', async (_name, extra, status) => {
    const g = gate();
    const env = { GITHUB_REF: undefined, GITHUB_REF_NAME: `ci/h-dev-${g.short}` };
    expect(await drive(g, hReporter(), 'e2e:connectors', { argv: [...RUNNER, 'e2e/connectors.spec.ts', ...extra] }, env, status)).toBeUndefined();
    expect(noBundle(g)).toBe(true);
    expect(errors).not.toHaveBeenCalled();
    expect(logs).toHaveBeenCalledWith(expect.stringContaining('not written'));
  });

  describe('as the design group names it', () => {
    const SPECS = ['design.spec.ts', 'design-comments.spec.ts', 'design-history.spec.ts', 'design-export.spec.ts', 'design-provisional.spec.ts' /* P4-A2 G2.6 */];
    const cases = SPECS.map((file, k) => caseIn(file, k));

    it('writes E1’s bundle on `ci/e1-final-*` for the `e2e:design` command, and fails it narrowed', async () => {
      const g = gate({ label: 'e1-final' });
      expect(await drive(g, new DesignFinalReporter(), 'e2e:design', { cases })).toBeUndefined();
      expect(existsSync(join(bundleOf(g), 'manifest.json'))).toBe(true);
      rmSync(join(g.checkout, 'test-results'), { recursive: true });
      const narrowed = [...RUNNER, ...playwrightArgs(SCRIPTS['e2e:design']!)!, '--grep-invert', 'menu'];
      expect(await drive(g, new DesignFinalReporter(), 'e2e:design', { cases, argv: narrowed })).toEqual({ status: 'failed' });
      expect(said()).toContain('adds --grep-invert menu');
      expect(noBundle(g)).toBe(true);
    });

    it('does nothing on P3-F’s hand-back ref, which the dashboard group carries', async () => {
      const g = gate({ label: 'p3f-final' });
      expect(await drive(g, new DesignFinalReporter(), 'e2e:design', { cases })).toBeUndefined();
      expect(noBundle(g)).toBe(true);
    });
  });

  describe('as the dashboard group names it', () => {
    const cases = DASHBOARD_ACCEPTANCE.flatMap(({ file, tests }) => Array.from({ length: tests }, (_, k) => caseIn(file, k)));
    const dashboard = (g: Gate, d: Driven = {}) => drive(g, new DashboardFinalReporter(), 'e2e:dashboard', { cases, forbidOnly: false, configFile: 'playwright.dashboard.config.ts', ...d });

    it.each(['e2-final', 'p3f-final'])('writes the plain bundle on `ci/%s-*` for the `e2e:dashboard` command and its declared counts', async (label) => {
      const g = gate({ label });
      expect(await dashboard(g)).toBeUndefined();
      expect(JSON.parse(readFileSync(join(bundleOf(g), 'manifest.json'), 'utf8'))).toMatchObject({ commit: g.source, buildCommit: g.wrapper, variant: 'plain', tgz: 'plain.tgz' });
    });

    it('fails P3-F’s hand-back run short of a declared case or with one skipped', async () => {
      const g = gate({ label: 'p3f-final' });
      expect(await dashboard(g, { cases: cases.slice(1) })).toEqual({ status: 'failed' });
      expect(said()).toContain('dashboard.spec.ts: 3 cases of the declared 4');
      expect(await dashboard(g, { statuses: cases.map((_, k) => (k === 5 ? 'skipped' : 'passed')) })).toEqual({ status: 'failed' });
      expect(said()).toContain('a skipped case');
      expect(noBundle(g)).toBe(true);
    });
  });
});
