// P3-E1 M6 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M6; gate-offload Decision Log 50 with its
// 16:52Z schema and 19:57Z selection): the Design acceptance run's final bundle. The reserved `ci/e1-final-<short>` ref
// selects it; any other ref is a no-op whatever the run's outcome. Once selected, every precondition fails the run with a
// named reason: not CI, not macOS, no `Evidence: yes` trailer, HEAD differing from GITHUB_SHA or the build key, not exactly
// one gate parent, the ref's short sha not the parent's, differing trees, `out/` differing from the cache's plain variant,
// and a run that is not the whole intended invocation passed (a failure, a skip, a missing spec, a filter). Tiny fake
// files and injected command answers stand for git, tar and the build cache; nothing is built.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { finalBundle, intendedSpecs, inventory, invocationProblems, selectedRef, type BundleContext, type Command, type InvocationSummary } from '../../e2e/support/design-bundle';

const SOURCE = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const WRAPPER = 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678';
const TREE = '1111111111111111111111111111111111111111';
const SCRIPT = 'scripts/e2e-build.sh plain && playwright test e2e/design.spec.ts e2e/design-comments.spec.ts e2e/design-history.spec.ts e2e/design-export.spec.ts --add-reporter=./e2e/support/design-final-reporter.ts';
const SPECS = ['design.spec.ts', 'design-comments.spec.ts', 'design-history.spec.ts', 'design-export.spec.ts'];
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface World {
  ctx: BundleContext;
  calls: string[];
  root: string;
  cache: string;
}

/** A checkout with a two-file out/, a cache holding the same plain build, and git/tar/digest answers for a good final run. */
function world(over: { env?: Record<string, string | undefined>; platform?: string; commit?: string; parentCommit?: string | null; fetchable?: boolean; digest?: string; cacheExtra?: boolean; tarList?: (files: string[]) => string[] } = {}): World {
  const root = mkdtempSync(join(tmpdir(), 'design-bundle-'));
  roots.push(root);
  const cache = join(root, 'cache');
  const files: Record<string, string> = { 'main/index.js': 'main();\n', 'renderer/index.html': '<!doctype html>\n' };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, 'out', path, '..'), { recursive: true });
    writeFileSync(join(root, 'out', path), text);
    mkdirSync(join(cache, WRAPPER, 'plain', 'out', path, '..'), { recursive: true });
    writeFileSync(join(cache, WRAPPER, 'plain', 'out', path), text);
  }
  if (over.cacheExtra) writeFileSync(join(cache, WRAPPER, 'plain', 'out', 'stale.js'), 'old\n');
  writeFileSync(join(cache, WRAPPER, 'plain', 'digest'), 'd'.repeat(64));
  const commit = over.commit ?? `tree ${TREE}\nparent ${SOURCE}\nauthor a <a> 1 +0000\ncommitter a <a> 1 +0000\n\nci-gate: ${SOURCE.slice(0, 8)}\n\nNonce: 1-2\nGates: e2e:design\nEvidence: yes\n`;
  let parentCommit = over.parentCommit === undefined ? `tree ${TREE}\nauthor a <a> 1 +0000\ncommitter a <a> 1 +0000\n\nP3-E1: the source\n` : over.parentCommit;
  const calls: string[] = [];
  const run: Command = (file, args) => {
    const line = `${file} ${args.join(' ')}`;
    calls.push(line);
    if (file === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return `${WRAPPER}\n`;
    if (file === 'git' && args[0] === 'cat-file' && args[1] === 'commit' && args[2] === 'HEAD') return commit;
    if (file === 'git' && args[0] === 'cat-file' && args[1] === 'commit' && args[2] === SOURCE) {
      if (parentCommit === null) throw new Error(`fatal: Not a valid object name ${SOURCE}`);
      return parentCommit;
    }
    if (file === 'git' && args[0] === 'fetch') {
      if (!over.fetchable) throw new Error('fatal: could not fetch');
      parentCommit = `tree ${TREE}\nauthor a <a> 1 +0000\ncommitter a <a> 1 +0000\n\nP3-E1: the source\n`;
      return '';
    }
    if (file === '/bin/sh') return `${over.digest ?? 'd'.repeat(64)}  -\n`;
    if (file === 'tar' && args.includes('-czf')) {
      writeFileSync(args[args.indexOf('-czf') + 1]!, 'fake archive bytes');
      return '';
    }
    if (file === 'tar' && args[0] === '-tzf') {
      const listed = ['out/', 'out/main/', 'out/main/index.js', 'out/renderer/', 'out/renderer/index.html'];
      return `${(over.tarList ? over.tarList(listed) : listed).join('\n')}\n`;
    }
    throw new Error(`unexpected command ${line}`);
  };
  const env = { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REF: `refs/heads/ci/e1-final-${SOURCE.slice(0, 8)}`, GITHUB_SHA: WRAPPER, MAWS_E2E_BUILD_KEY: WRAPPER, MAWS_E2E_BUILD_CACHE: cache, ...over.env };
  return { ctx: { root, env, platform: over.platform ?? 'darwin', run, log: () => {} }, calls, root, cache };
}

const passing = (over: Partial<InvocationSummary> = {}): InvocationSummary => ({
  status: 'passed',
  specs: [...SPECS],
  tests: SPECS.map((file, k) => ({ file, title: `case ${k}`, outcome: 'expected' })),
  filtered: [],
  ...over,
});

describe('which run bundles', () => {
  it('selects only the reserved e1-final ref, by GITHUB_REF or GITHUB_REF_NAME', () => {
    expect(selectedRef({ GITHUB_REF: 'refs/heads/ci/e1-final-a1b2c3d4' })).toBe('ci/e1-final-a1b2c3d4');
    expect(selectedRef({ GITHUB_REF_NAME: 'ci/e1-final-a1b2c3d4' })).toBe('ci/e1-final-a1b2c3d4');
    expect(selectedRef({ GITHUB_REF: 'refs/heads/ci/e1-development-a1b2c3d4' })).toBeNull();
    expect(selectedRef({ GITHUB_REF: 'refs/heads/ci/e2-final-a1b2c3d4' })).toBeNull();
    expect(selectedRef({})).toBeNull();
  });

  it('is a no-op on any other ref, whatever the outcome', () => {
    const w = world({ env: { GITHUB_REF: 'refs/heads/ci/e1-development-a1b2c3d4' } });
    expect(finalBundle(w.ctx, passing({ status: 'failed' }))).toEqual({ selected: false });
    expect(w.calls).toEqual([]);
    expect(existsSync(join(w.root, 'test-results', 'bundle'))).toBe(false);
  });

  it('reads the intended specs from the package script', () => {
    expect(intendedSpecs(SCRIPT)).toEqual(SPECS);
    expect(intendedSpecs('scripts/e2e-build.sh plain')).toEqual([]);
  });
});

describe('the whole intended invocation', () => {
  it('passes only as a passed run of every intended spec with every case expected and nothing filtered', () => {
    expect(invocationProblems(passing(), SPECS)).toEqual([]);
    expect(invocationProblems(passing({ status: 'failed' }), SPECS)).toEqual(['the run did not pass (failed)']);
    expect(invocationProblems(passing({ tests: [...passing().tests, { file: 'design.spec.ts', title: 'held', outcome: 'skipped' }] }), SPECS)).toEqual(['a skipped case: design.spec.ts › held']);
    expect(invocationProblems(passing({ tests: [...passing().tests, { file: 'design.spec.ts', title: 'bad', outcome: 'unexpected' }] }), SPECS)).toEqual(['a case not expected (unexpected): design.spec.ts › bad']);
    expect(invocationProblems(passing({ tests: [...passing().tests, { file: 'design.spec.ts', title: 'never', outcome: 'not run' }] }), SPECS)).toEqual(['a case not expected (not run): design.spec.ts › never']);
    expect(invocationProblems(passing({ specs: SPECS.slice(1), tests: passing().tests.slice(1) }), SPECS)).toEqual(['an intended spec did not run: design.spec.ts']);
    expect(invocationProblems(passing({ specs: [...SPECS, 'design-scale.spec.ts'] }), SPECS)).toEqual(['a spec outside the intended invocation ran: design-scale.spec.ts']);
    expect(invocationProblems(passing({ filtered: ['--grep /export/'] }), SPECS)).toEqual(['the invocation was filtered: --grep /export/']);
    expect(invocationProblems(passing({ tests: [] }), SPECS)).toContain('no case ran');
    expect(invocationProblems(passing(), [])).toEqual(['the package script names no spec']);
  });
});

describe('a selected run', () => {
  it('bundles out/ as plain.tgz beside its manifest: the source commit, the build commit, the archive digest and every file', () => {
    const w = world();
    const outcome = finalBundle(w.ctx, passing());
    expect(outcome).toMatchObject({ selected: true, ok: true });
    const bundle = join(w.root, 'test-results', 'bundle');
    const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest).toEqual({
      commit: SOURCE,
      buildCommit: WRAPPER,
      variant: 'plain',
      tgz: 'plain.tgz',
      sha256: sha('fake archive bytes'),
      files: [
        { path: 'out/main/index.js', bytes: 8, sha256: sha('main();\n') },
        { path: 'out/renderer/index.html', bytes: 16, sha256: sha('<!doctype html>\n') },
      ],
    });
    expect(readFileSync(join(bundle, 'plain.tgz'), 'utf8')).toBe('fake archive bytes');
    // the archive is made from out/ alone, without macOS metadata, and listed back before the manifest is written
    expect(w.calls.find((c) => c.startsWith('tar') && c.includes('-czf'))).toMatch(/--no-mac-metadata --no-xattrs -czf \S+ -C \S+ out$/);
    expect(w.calls.some((c) => c.startsWith('tar -tzf'))).toBe(true);
  });

  it('replaces a previous bundle rather than adding to it', () => {
    const w = world();
    mkdirSync(join(w.root, 'test-results', 'bundle'), { recursive: true });
    writeFileSync(join(w.root, 'test-results', 'bundle', 'harness.tgz'), 'stale');
    expect(finalBundle(w.ctx, passing())).toMatchObject({ ok: true });
    expect(existsSync(join(w.root, 'test-results', 'bundle', 'harness.tgz'))).toBe(false);
  });

  it('reads the parent from the commit object and fetches it when the shallow checkout lacks it', () => {
    const w = world({ parentCommit: null, fetchable: true });
    expect(finalBundle(w.ctx, passing())).toMatchObject({ ok: true });
    expect(w.calls).toContain(`git fetch --no-tags --depth=1 origin ${SOURCE}`);
    const missing = world({ parentCommit: null, fetchable: false });
    expect(finalBundle(missing.ctx, passing())).toEqual({ selected: true, ok: false, reason: expect.stringMatching(/^the gate parent .* could not be read or fetched/) });
  });

  const refusals: [string, Parameters<typeof world>[0], RegExp][] = [
    ['not on CI', { env: { CI: undefined } }, /^not on CI/],
    ['not on macOS', { platform: 'linux' }, /^not on macOS/],
    ['no Evidence trailer', { commit: `tree ${TREE}\nparent ${SOURCE}\n\nci-gate: ${SOURCE.slice(0, 8)}\n\nNonce: 1-2\n` }, /^no `Evidence: yes` trailer/],
    ['an Evidence trailer outside the trailers', { commit: `tree ${TREE}\nparent ${SOURCE}\n\nci-gate: ${SOURCE.slice(0, 8)}\n\nEvidence: yes\nmore words here\n` }, /^no `Evidence: yes` trailer/],
    ['HEAD not GITHUB_SHA', { env: { GITHUB_SHA: SOURCE } }, /^HEAD .* differs from GITHUB_SHA/],
    ['HEAD not the build key', { env: { MAWS_E2E_BUILD_KEY: SOURCE } }, /^HEAD .* differs from MAWS_E2E_BUILD_KEY/],
    ['two parents', { commit: `tree ${TREE}\nparent ${SOURCE}\nparent ${WRAPPER}\n\nci-gate: ${SOURCE.slice(0, 8)}\n\nEvidence: yes\n` }, /^the gate commit has 2 parents/],
    ['no parent', { commit: `tree ${TREE}\n\nci-gate: x\n\nEvidence: yes\n` }, /^the gate commit has 0 parents/],
    ['not a ci-gate wrapper', { commit: `tree ${TREE}\nparent ${SOURCE}\n\nP3-E1: a commit\n\nEvidence: yes\n` }, /^HEAD is not ci-gate's wrapper/],
    ['the ref names another source', { env: { GITHUB_REF: 'refs/heads/ci/e1-final-deadbeef' } }, /^the ref .* does not name the gate parent/],
    ['the trees differ', { parentCommit: `tree ${'2'.repeat(40)}\n\nsource\n` }, /^the gate commit's tree .* differs from its parent's/],
    ['no build cache', { env: { MAWS_E2E_BUILD_CACHE: undefined } }, /^no MAWS_E2E_BUILD_CACHE/],
    ['out/ differs from the cache digest', { digest: 'e'.repeat(64) }, /^out\/ \(sha256 e+\) differs from the cache's plain build/],
    ['the cache holds another file', { cacheExtra: true }, /^out\/ differs from the cache's plain out\/: only in the cache: out\/stale.js/],
    ['the archive lists something else', { tarList: (files) => [...files, 'out/._index.js'] }, /^the archive does not list exactly out\/: extra out\/\._index\.js/],
  ];
  for (const [what, over, reason] of refusals) {
    it(`fails the run, writing no bundle: ${what}`, () => {
      const w = world(over);
      const outcome = finalBundle(w.ctx, passing());
      expect(outcome).toEqual({ selected: true, ok: false, reason: expect.stringMatching(reason) });
      expect(existsSync(join(w.root, 'test-results', 'bundle', 'manifest.json'))).toBe(false);
    });
  }

  it('fails a run that was not the whole intended invocation before reading any provenance', () => {
    const w = world();
    expect(finalBundle(w.ctx, passing({ tests: [...passing().tests, { file: 'design.spec.ts', title: 'later', outcome: 'skipped' }] }))).toEqual({ selected: true, ok: false, reason: 'a skipped case: design.spec.ts › later' });
    expect(w.calls).toEqual([]);
  });
});

describe('the inventory', () => {
  it('lists every file under out/ by byte order with its size and digest, and refuses what is not a regular file', () => {
    const root = mkdtempSync(join(tmpdir(), 'design-inventory-'));
    roots.push(root);
    mkdirSync(join(root, 'out', 'b'), { recursive: true });
    writeFileSync(join(root, 'out', 'b', 'Z.js'), 'z');
    writeFileSync(join(root, 'out', 'a.js'), 'aa');
    writeFileSync(join(root, 'out', 'B.js'), '');
    expect(inventory(join(root, 'out'))).toEqual([
      { path: 'out/B.js', bytes: 0, sha256: sha('') },
      { path: 'out/a.js', bytes: 2, sha256: sha('aa') },
      { path: 'out/b/Z.js', bytes: 1, sha256: sha('z') },
    ]);
    expect(() => inventory(join(root, 'missing'))).toThrow(/no out\//);
  });
});
