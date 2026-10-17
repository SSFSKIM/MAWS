// P3-E2 M6 (gate-offload Decision Log 50, its provenance, schema and selection amendments; P3-E Decision Log 36; E2's
// execution Decision Logs 19, 24 and 31): the dashboard acceptance run's final bundle. The reserved `ci/e2-final-*` ref
// selects the run, whatever follows the prefix; any other ref is a no-op whatever the outcome. Once selected, every
// precondition fails the run by name: the whole declared invocation passed (the command line and the config unnarrowed,
// every declared file at its declared count, no case skipped), on CI, on macOS, the wrapper's provenance (HEAD =
// GITHUB_SHA = the build key, one parent, its subject and `Evidence: yes`, the ref naming the parent, equal trees, the
// parent read from its commit object and fetched when the shallow checkout lacks it) and out/ equal to the cache's
// plain build; then the archive (tar under COPYFILE_DISABLE=1, listed back) and the manifest's exact fields. git goes
// through a fake command; the digest and tar run for real over a tiny out/.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DASHBOARD_ACCEPTANCE, DASHBOARD_CONFIG } from '../../e2e/support/dashboard-acceptance';
import { finalBundle, invocationProblems, selectedRef, type BundleContext, type Command, type InvocationSummary } from '../../e2e/support/dashboard-bundle';

const PARENT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const HEAD = 'ffeeddccbbaa99887766554433221100ffeeddcc';
const TREE = '0123456789abcdef0123456789abcdef01234567';
const REF = `refs/heads/ci/e2-final-${PARENT.slice(0, 8)}`;
const ARGV = ['/usr/local/bin/node', '/ci/node_modules/@playwright/test/cli.js', 'test', '--config', DASHBOARD_CONFIG];

let root: string;
let cache: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-dash-bundle-'));
  cache = mkdtempSync(join(tmpdir(), 'maws-dash-cache-'));
  mkdirSync(join(root, 'out', 'main'), { recursive: true });
  mkdirSync(join(root, 'out', 'renderer'), { recursive: true });
  writeFileSync(join(root, 'out', 'main', 'index.js'), 'console.log("main")\n');
  writeFileSync(join(root, 'out', 'renderer', 'index.html'), '<!doctype html>\n');
  writeFileSync(join(root, 'out', 'b.txt'), 'b');
  storeCache();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
});

/** The cache's plain build of HEAD, as e2e-build.sh stores it: a copy of out/ and its digest. */
function storeCache(): void {
  const entry = join(cache, HEAD, 'plain');
  rmSync(entry, { recursive: true, force: true });
  mkdirSync(entry, { recursive: true });
  cpSync(join(root, 'out'), join(entry, 'out'), { recursive: true });
  const digest = execFileSync('/bin/sh', ['-c', 'cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256', 'sh', join(entry, 'out')], { encoding: 'utf8' }).split(/\s+/)[0];
  writeFileSync(join(entry, 'digest'), `${digest}\n`);
}

const commit = ({ tree = TREE, parents = [PARENT], subject = `ci-gate: ${PARENT.slice(0, 8)}`, trailers = ['Nonce: 1-2', 'Gates: e2e:dashboard', 'Evidence: yes'] } = {}) =>
  [`tree ${tree}`, ...parents.map((p) => `parent ${p}`), 'author ci <ci@x> 0 +0000', 'committer ci <ci@x> 0 +0000', '', subject, '', ...trailers, ''].join('\n');

interface Git {
  head?: string;
  wrapper?: string;
  parent?: string | null; // null: not in the checkout
  fetched?: string | null; // null: the fetch fails
}
/** git through a fake; everything else (the digest, tar) for real, with the environment it was given recorded. */
function command(git: Git, calls: { file: string; args: string[]; env?: Record<string, string> }[] = []): Command {
  let parent = git.parent === undefined ? commit({ parents: ['9999999999999999999999999999999999999999'], subject: 'the source' }) : git.parent;
  return (file, args, options = {}) => {
    calls.push({ file, args, ...(options.env && { env: options.env }) });
    if (file !== 'git') return execFileSync(file, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...options.env } });
    const words = args.join(' ');
    if (words === 'rev-parse HEAD') return `${git.head ?? HEAD}\n`;
    if (words === 'cat-file commit HEAD') return git.wrapper ?? commit();
    if (words === `cat-file commit ${PARENT}`) {
      if (parent === null) throw new Error(`fatal: Not a valid object name ${PARENT}`);
      return parent;
    }
    if (words === `fetch --no-tags --depth=1 origin ${PARENT}`) {
      if (git.fetched === null) throw new Error('fatal: could not fetch');
      parent = git.fetched ?? commit({ parents: [], subject: 'the source' });
      return '';
    }
    throw new Error(`unexpected git ${words}`);
  };
}

const ENV = { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REF: REF, GITHUB_SHA: HEAD, MAWS_E2E_BUILD_KEY: HEAD };
const context = (over: Partial<BundleContext> & { git?: Git } = {}): BundleContext => ({ root, env: { ...ENV, MAWS_E2E_BUILD_CACHE: cache }, platform: 'darwin', run: command(over.git ?? {}), log: () => {}, ...over });
const whole = (): InvocationSummary => ({
  status: 'passed',
  argv: ARGV,
  config: { grep: /.*/, grepInvert: null, shard: null },
  tests: DASHBOARD_ACCEPTANCE.flatMap(({ file, tests }) => Array.from({ length: tests }, (_, k) => ({ file, title: `case ${k}`, outcome: 'expected' }))),
});
const reasonOf = (outcome: ReturnType<typeof finalBundle>) => (outcome.selected && !outcome.ok ? outcome.reason : `not a failure: ${JSON.stringify(outcome)}`);

describe('the declared acceptance list', () => {
  it('declares each spec file’s own count of cases', () => {
    for (const { file, tests } of DASHBOARD_ACCEPTANCE) {
      const source = readFileSync(join(__dirname, '..', '..', 'e2e', file), 'utf8');
      expect(source.match(/^test\(/gm)?.length ?? 0, file).toBe(tests);
      expect(source, `${file} skips nothing of its own`).not.toMatch(/^test\.skip\(/m);
    }
  });
});

describe('selection', () => {
  it('is the reserved ref, by its whole `ci/e2-final-` prefix, from GITHUB_REF or GITHUB_REF_NAME', () => {
    expect(selectedRef({ GITHUB_REF: REF })).toBe(`ci/e2-final-${PARENT.slice(0, 8)}`);
    expect(selectedRef({ GITHUB_REF_NAME: 'ci/e2-final-0badc0de' })).toBe('ci/e2-final-0badc0de');
    expect(selectedRef({ GITHUB_REF: 'refs/heads/ci/e2-final-anything' })).toBe('ci/e2-final-anything'); // the glob is not narrowed
    for (const ref of ['refs/heads/ci/e2-accept-mac-a1b2c3d4', 'refs/heads/ci/e1-final-a1b2c3d4', 'refs/heads/ci/xe2-final-a1b2c3d4', 'refs/heads/main'])
      expect(selectedRef({ GITHUB_REF: ref }), ref).toBeNull();
    expect(selectedRef({})).toBeNull();
  });

  it('leaves any other run alone, whatever its outcome', () => {
    const failed = { ...whole(), status: 'failed', tests: [] };
    expect(finalBundle(context({ env: { ...ENV, GITHUB_REF: 'refs/heads/ci/e2-accept-mac-a1b2c3d4' } }), failed)).toEqual({ selected: false });
    expect(existsSync(join(root, 'test-results', 'bundle'))).toBe(false);
  });
});

describe('the whole declared invocation', () => {
  it('is the package command exactly, the config unnarrowed', () => {
    expect(invocationProblems(whole())).toEqual([]);
    expect(invocationProblems({ ...whole(), argv: [...ARGV.slice(0, 3), `--config=${DASHBOARD_CONFIG}`] })).toEqual([]);
    expect(invocationProblems({ ...whole(), argv: [...ARGV.slice(0, 3), '-c', `./${DASHBOARD_CONFIG}`] })).toEqual([]);
    const narrowed = (extra: string[]) => invocationProblems({ ...whole(), argv: [...ARGV, ...extra] });
    expect(narrowed(['--grep', 'export']).join('; ')).toMatch(/--grep export/);
    expect(narrowed(['-g', 'export']).join('; ')).toMatch(/-g export/);
    expect(narrowed(['--grep-invert=history']).join('; ')).toMatch(/--grep-invert=history/);
    expect(narrowed(['e2e/dashboard.spec.ts']).join('; ')).toMatch(/a test file named on the command line: e2e\/dashboard\.spec\.ts/);
    expect(narrowed(['dashboard-export.spec.ts:292']).join('; ')).toMatch(/dashboard-export\.spec\.ts:292/);
    for (const flag of ['--last-failed', '--only-changed', '--shard=1/2', '--project=x', '--max-failures=1', '-x', '--test-list=a.txt']) expect(narrowed([flag]).join('; '), flag).toMatch(new RegExp(flag.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
    expect(invocationProblems({ ...whole(), argv: ARGV.slice(0, 3) }).join('; ')).toMatch(/not run with --config playwright\.dashboard\.config\.ts/);
    expect(invocationProblems({ ...whole(), argv: [...ARGV.slice(0, 3), '--config', 'playwright.config.ts'] }).join('; ')).toMatch(/playwright\.config\.ts/);
    expect(invocationProblems({ ...whole(), argv: ['/node', '/cli.js', 'show-report'] }).join('; ')).toMatch(/not `playwright test`/);
    expect(invocationProblems({ ...whole(), config: { grep: /export/, grepInvert: null, shard: null } }).join('; ')).toMatch(/grep/);
    expect(invocationProblems({ ...whole(), config: { grep: /.*/, grepInvert: /x/, shard: null } }).join('; ')).toMatch(/grepInvert/);
    expect(invocationProblems({ ...whole(), config: { grep: /.*/, grepInvert: null, shard: { current: 1, total: 2 } } }).join('; ')).toMatch(/shard 1\/2/);
  });

  it('ran every declared file at its declared count, no other, every case expected and none skipped, and passed', () => {
    const [first, ...rest] = whole().tests;
    expect(invocationProblems({ ...whole(), tests: rest }).join('; ')).toMatch(new RegExp(`${first!.file.replace('.', '\\.')}: \\d+ cases of the declared \\d+`));
    expect(invocationProblems({ ...whole(), tests: whole().tests.filter((t) => t.file !== 'dashboard-history.spec.ts') }).join('; ')).toMatch(/dashboard-history\.spec\.ts: 0 cases of the declared 1/);
    expect(invocationProblems({ ...whole(), tests: [...whole().tests, { file: 'dashboard-scale.spec.ts', title: 'scale', outcome: 'skipped' }] }).join('; ')).toMatch(/a file outside the declared list ran: dashboard-scale\.spec\.ts/);
    const skipped = whole().tests.map((t, k) => (k === 2 ? { ...t, outcome: 'skipped' } : t));
    expect(invocationProblems({ ...whole(), tests: skipped }).join('; ')).toMatch(/a skipped case: dashboard\.spec\.ts › case 2/);
    const failed = whole().tests.map((t, k) => (k === 0 ? { ...t, outcome: 'unexpected' } : t));
    expect(invocationProblems({ ...whole(), status: 'failed', tests: failed }).join('; ')).toMatch(/the run did not pass \(failed\).*a case not expected \(unexpected\)/);
  });
});

describe('a selected run', () => {
  it('fails by name for each missing precondition, writing no bundle', () => {
    const cases: [string, BundleContext, RegExp][] = [
      ['not CI', context({ env: { ...ENV, CI: undefined, MAWS_E2E_BUILD_CACHE: cache } }), /not on CI/],
      ['not macOS', context({ platform: 'linux' }), /not on macOS \(linux\)/],
      ['HEAD ≠ GITHUB_SHA', context({ env: { ...ENV, GITHUB_SHA: PARENT, MAWS_E2E_BUILD_CACHE: cache } }), /HEAD .* differs from GITHUB_SHA/],
      ['HEAD ≠ the build key', context({ env: { ...ENV, MAWS_E2E_BUILD_KEY: PARENT, MAWS_E2E_BUILD_CACHE: cache } }), /differs from the build cache key MAWS_E2E_BUILD_KEY/],
      ['two parents', context({ git: { wrapper: commit({ parents: [PARENT, HEAD] }) } }), /2 parents, not exactly one/],
      ['not the wrapper', context({ git: { wrapper: commit({ subject: 'Merge branch x' }) } }), /not ci-gate's wrapper/],
      ['no evidence trailer', context({ git: { wrapper: commit({ trailers: ['Nonce: 1-2'] }) } }), /no `Evidence: yes` trailer/],
      ['the ref names another commit', context({ env: { ...ENV, GITHUB_REF: 'refs/heads/ci/e2-final-0badc0de', MAWS_E2E_BUILD_CACHE: cache } }), /does not name the gate parent/],
      ['the parent unreadable', context({ git: { parent: null, fetched: null } }), /the gate parent .* could not be read or fetched/],
      ['the trees differ', context({ git: { parent: commit({ tree: 'f'.repeat(40), parents: [] }) } }), /tree .* differs from its parent's/],
      ['no cache', context({ env: { ...ENV } }), /no MAWS_E2E_BUILD_CACHE/],
    ];
    for (const [name, ctx, reason] of cases) {
      const outcome = finalBundle(ctx, whole());
      expect(outcome.selected, name).toBe(true);
      expect(reasonOf(outcome), name).toMatch(reason);
    }
    expect(reasonOf(finalBundle(context(), { ...whole(), argv: [...ARGV, '--grep', 'x'] }))).toMatch(/the invocation was narrowed: --grep x/);
    expect(existsSync(join(root, 'test-results', 'bundle'))).toBe(false);
  });

  it('fails when out/ is not the cache’s plain build, by its digest and file by file', () => {
    writeFileSync(join(root, 'out', 'b.txt'), 'changed');
    expect(reasonOf(finalBundle(context(), whole()))).toMatch(/out\/ \(sha256 [0-9a-f]+\) differs from the cache's plain build/);
    rmSync(join(cache, HEAD, 'plain'), { recursive: true });
    expect(reasonOf(finalBundle(context(), whole()))).toMatch(/no plain build in the cache/);
  });

  it('archives out/ without metadata entries and writes the manifest’s exact fields, the parent fetched into the shallow checkout', () => {
    const calls: { file: string; args: string[]; env?: Record<string, string> }[] = [];
    const outcome = finalBundle(context({ run: command({ parent: null }, calls) }), whole());
    if (!outcome.selected || !outcome.ok) throw new Error(reasonOf(outcome));
    expect(calls.some((c) => c.file === 'git' && c.args.join(' ') === `fetch --no-tags --depth=1 origin ${PARENT}`)).toBe(true);
    const tar = calls.find((c) => c.file === 'tar' && c.args.includes('-czf'))!;
    expect(tar.env).toMatchObject({ COPYFILE_DISABLE: '1' });
    const bundle = join(root, 'test-results', 'bundle');
    const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8')) as Record<string, unknown> & { files: { path: string; bytes: number; sha256: string }[] };
    expect(Object.keys(manifest)).toEqual(['commit', 'buildCommit', 'variant', 'tgz', 'sha256', 'files']);
    expect(manifest).toMatchObject({ commit: PARENT, buildCommit: HEAD, variant: 'plain', tgz: 'plain.tgz' });
    expect(manifest.sha256).toBe(execFileSync('shasum', ['-a', '256', join(bundle, 'plain.tgz')], { encoding: 'utf8' }).split(/\s+/)[0]);
    expect(manifest.files.map((f) => f.path)).toEqual(['out/b.txt', 'out/main/index.js', 'out/renderer/index.html']);
    expect(manifest.files[0]).toEqual({ path: 'out/b.txt', bytes: 1, sha256: execFileSync('shasum', ['-a', '256', join(root, 'out', 'b.txt')], { encoding: 'utf8' }).split(/\s+/)[0] });
    const listed = execFileSync('tar', ['-tzf', join(bundle, 'plain.tgz')], { encoding: 'utf8' }).split('\n').filter((l) => l && !l.endsWith('/'));
    expect(listed.sort()).toEqual(manifest.files.map((f) => f.path));
    expect(listed.some((l) => /(^|\/)\._/.test(l))).toBe(false);
  });
});
