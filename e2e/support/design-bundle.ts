// P3-E1 M6 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M6; gate-offload Decision Log 50, its 14:55Z
// provenance, 16:52Z schema and 19:57Z selection): the Design acceptance run's final bundle, what the final reporter
// (./design-final-reporter.ts) does at the end of `pnpm e2e:design`. The architect's one paid live run takes the mini's
// plain `out/` from this bundle instead of building on the MacBook.
//
// Selection. A run whose gate ref is `ci/e1-final-<short>` (ci-gate.sh `--label e1-final`) is E1's final run by
// declaration; any other ref leaves the reporter a no-op whatever the outcome. Once selected, every precondition is a check
// that fails the run with a named reason, in this order: the whole intended invocation passed (every spec the package
// script names ran, nothing filtered, every case expected, none skipped); on CI; on macOS; HEAD is ci-gate's wrapper
// (subject `ci-gate: <short>`) with exactly one parent, the `Evidence: yes` trailer, and HEAD = GITHUB_SHA =
// MAWS_E2E_BUILD_KEY; the ref's short sha is that parent's; the parent's commit object is read (fetched at depth 1 when
// the shallow checkout lacks it) and its tree equals the wrapper's; `out/` equals the build cache's plain variant for
// that key, both by e2e-build.sh's own digest and file by file. Only then is `out/` archived (`tar` without macOS
// metadata), the archive listed back against the inventory, and `test-results/bundle/{plain.tgz, manifest.json}` written
// in place of any earlier bundle:
//   manifest.json {commit (the source: the gate parent), buildCommit (the mini's checkout), variant: 'plain',
//                  tgz: 'plain.tgz', sha256 (the archive's), files: [{path: 'out/…', bytes, sha256}] by byte order}
// Free of Playwright: git, tar and the digest go through an injected command, so test/support/design-bundle.test.ts runs
// every refusal under vitest with tiny fake files.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

/** Runs a command and answers its stdout; throws when it fails. */
export type Command = (file: string, args: string[], options?: { env?: Record<string, string> }) => string;

export interface BundleContext {
  /** The checkout (where `out/` and `test-results/` are). */
  root: string;
  env: Record<string, string | undefined>;
  platform: string;
  run: Command;
  log: (line: string) => void;
}

export interface InvocationSummary {
  /** The run's own status (Playwright's `FullResult.status`). */
  status: string;
  /** Every spec file the run loaded, by its name under e2e/. */
  specs: string[];
  /** Every case with its outcome (`expected`, `unexpected`, `flaky`, `skipped`, or `not run`). */
  tests: { file: string; title: string; outcome: string }[];
  /** How the run was narrowed (a grep, a shard, a last-failed or changed-only run), as words; empty when whole. */
  filtered: string[];
}

export type BundleOutcome = { selected: false } | { selected: true; ok: true; manifest: BundleManifest } | { selected: true; ok: false; reason: string };

export interface BundleFile {
  path: string;
  bytes: number;
  sha256: string;
}
export interface BundleManifest {
  commit: string;
  buildCommit: string;
  variant: 'plain';
  tgz: 'plain.tgz';
  sha256: string;
  files: BundleFile[];
}

const FINAL_REF = /^(?:refs\/heads\/)?(ci\/e1-final-([0-9a-f]{8}))$/;
const SHA = /^[0-9a-f]{40}$/;

/** The reserved final ref this run is on, else null (the reporter does nothing). */
export function selectedRef(env: Record<string, string | undefined>): string | null {
  for (const ref of [env.GITHUB_REF, env.GITHUB_REF_NAME]) {
    const match = ref ? FINAL_REF.exec(ref) : null;
    if (match) return match[1]!;
  }
  return null;
}

/** The spec files a package script runs (`e2e/<name>.spec.ts`), by name. */
export function intendedSpecs(script: string): string[] {
  return [...script.matchAll(/(?:^|\s)e2e\/([\w.-]+\.spec\.ts)(?=\s|$)/g)].map((m) => m[1]!);
}

/** The final reporter, as the package command names it. */
export const FINAL_REPORTER = 'e2e/support/design-final-reporter.ts';
/** The only options the package command passes. */
const ADMITTED_FLAGS = new Set(['--forbid-only']);

/**
 * How the runner's command line (the config's `argv`, `process.argv` of the runner) narrows the run, as words; empty
 * when it is the package command exactly: `playwright test`, every intended spec as `e2e/<name>` once and no other
 * argument, `--forbid-only`, and `--add-reporter` naming the final reporter (`=` or as the next word). Anything else,
 * whatever its alias or spelling (a grep or its inverse, the last failures, a test list, a location `file:line`, a
 * project, a shard, a stop after failures, words after `--`), is narrowing: the CLI applies several of these outside the
 * config the reporter sees, so the command line is the only complete record.
 */
export function invocationFilters(argv: readonly string[], intended: readonly string[], root: string): string[] {
  const at = argv.indexOf('test', 2);
  if (at < 0) return ['the invocation is not `playwright test`'];
  const words: string[] = [];
  const specs: string[] = [];
  const reporter = resolvePath(root, FINAL_REPORTER);
  const args = argv.slice(at + 1);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (ADMITTED_FLAGS.has(arg)) continue;
    if (arg === '--add-reporter' || arg.startsWith('--add-reporter=')) {
      const value = arg === '--add-reporter' ? args[++i] : arg.slice('--add-reporter='.length);
      if (value === undefined || resolvePath(root, value) !== reporter) words.push(`--add-reporter ${value ?? ''}`.trim());
      continue;
    }
    if (arg === '--') {
      words.push(`-- ${args.slice(i + 1).join(' ')}`.trim());
      break;
    }
    if (arg.startsWith('-')) words.push(i + 1 < args.length && !args[i + 1]!.startsWith('-') && !arg.includes('=') && !args[i + 1]!.startsWith('e2e/') ? `${arg} ${args[++i]}` : arg);
    else specs.push(arg);
  }
  const want = intended.map((name) => `e2e/${name}`);
  for (const spec of specs) if (!want.includes(spec)) words.push(`a spec filter outside the package command: ${spec}`);
  for (const spec of want) if (!specs.includes(spec)) words.push(`the package command's ${spec} not named`);
  return words;
}

/** Why the run was not the whole intended invocation passed; empty when it was. */
export function invocationProblems(run: InvocationSummary, intended: string[]): string[] {
  if (intended.length === 0) return ['the package script names no spec'];
  const problems: string[] = [];
  if (run.status !== 'passed') problems.push(`the run did not pass (${run.status})`);
  for (const spec of intended) if (!run.specs.includes(spec)) problems.push(`an intended spec did not run: ${spec}`);
  for (const spec of run.specs) if (!intended.includes(spec)) problems.push(`a spec outside the intended invocation ran: ${spec}`);
  for (const filter of run.filtered) problems.push(`the invocation was filtered: ${filter}`);
  if (run.tests.length === 0) problems.push('no case ran');
  for (const t of run.tests) {
    if (t.outcome === 'skipped') problems.push(`a skipped case: ${t.file} › ${t.title}`);
    else if (t.outcome !== 'expected') problems.push(`a case not expected (${t.outcome}): ${t.file} › ${t.title}`);
  }
  return problems;
}

/** Every file under `dir` as `out/<relative path>`, by byte order, with its size and sha256; anything else refused. */
export function inventory(dir: string, prefix = 'out'): BundleFile[] {
  if (!existsSync(dir)) throw new Error(`no out/ at ${dir}`);
  const files: BundleFile[] = [];
  const walk = (at: string, rel: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const relative = `${rel}/${name}`;
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path, relative);
      else if (stat.isFile()) {
        if (/[\n\\]/.test(relative)) throw new Error(`a file name the digest cannot carry: ${JSON.stringify(relative)}`);
        const bytes = readFileSync(path);
        files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      } else throw new Error(`not a regular file: ${relative}`);
    }
  };
  walk(dir, prefix);
  return files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

/** The commit object's header and message. */
function parseCommit(raw: string): { tree: string | null; parents: string[]; subject: string; trailers: string[] } {
  const split = raw.indexOf('\n\n');
  const header = split < 0 ? raw : raw.slice(0, split);
  const message = split < 0 ? '' : raw.slice(split + 2);
  const lines = header.split('\n');
  const tree = lines.find((l) => l.startsWith('tree '))?.slice(5).trim() ?? null;
  const parents = lines.filter((l) => l.startsWith('parent ')).map((l) => l.slice(7).trim());
  const paragraphs = message.trim().split(/\n\s*\n/);
  const last = paragraphs.length > 1 ? paragraphs.at(-1)!.split('\n') : [];
  // a trailer block is a last paragraph made only of `Key: value` lines
  const trailers = last.length > 0 && last.every((l) => /^[A-Za-z][\w-]*: \S/.test(l)) ? last : [];
  return { tree, parents, subject: paragraphs[0]?.split('\n')[0] ?? '', trailers };
}

const words = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0];

/** Every precondition after the invocation's, or the first that fails, by name. */
function provenance(ctx: BundleContext, ref: string): { ok: true; head: string; parent: string } | { ok: false; reason: string } {
  const { env, run } = ctx;
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true') return { ok: false, reason: `not on CI (CI=${env.CI ?? 'unset'}, GITHUB_ACTIONS=${env.GITHUB_ACTIONS ?? 'unset'})` };
  if (ctx.platform !== 'darwin') return { ok: false, reason: `not on macOS (${ctx.platform})` };
  const head = run('git', ['rev-parse', 'HEAD']).trim();
  if (!SHA.test(head)) return { ok: false, reason: `HEAD is not a commit (${head})` };
  if (head !== env.GITHUB_SHA) return { ok: false, reason: `HEAD ${head} differs from GITHUB_SHA ${env.GITHUB_SHA ?? 'unset'}` };
  if (head !== env.MAWS_E2E_BUILD_KEY) return { ok: false, reason: `HEAD ${head} differs from MAWS_E2E_BUILD_KEY ${env.MAWS_E2E_BUILD_KEY ?? 'unset'}` };
  const wrapper = parseCommit(run('git', ['cat-file', 'commit', 'HEAD']));
  if (wrapper.parents.length !== 1) return { ok: false, reason: `the gate commit has ${wrapper.parents.length} parents, not exactly one` };
  const parent = wrapper.parents[0]!;
  if (wrapper.subject !== `ci-gate: ${parent.slice(0, 8)}`) return { ok: false, reason: `HEAD is not ci-gate's wrapper of its parent (subject ${JSON.stringify(wrapper.subject)})` };
  if (!wrapper.trailers.includes('Evidence: yes')) return { ok: false, reason: `no \`Evidence: yes\` trailer on the gate commit (trailers ${JSON.stringify(wrapper.trailers)})` };
  if (ref !== `ci/e1-final-${parent.slice(0, 8)}`) return { ok: false, reason: `the ref ${ref} does not name the gate parent ${parent}` };
  let source: ReturnType<typeof parseCommit>;
  try {
    source = parseCommit(run('git', ['cat-file', 'commit', parent]));
  } catch {
    try {
      ctx.log(`design bundle: the gate parent ${parent} is not in the shallow checkout; fetching it`);
      run('git', ['fetch', '--no-tags', '--depth=1', 'origin', parent]);
      source = parseCommit(run('git', ['cat-file', 'commit', parent]));
    } catch (error) {
      return { ok: false, reason: `the gate parent ${parent} could not be read or fetched: ${words(error)}` };
    }
  }
  if (!wrapper.tree || wrapper.tree !== source.tree) return { ok: false, reason: `the gate commit's tree ${wrapper.tree} differs from its parent's ${source.tree}` };
  return { ok: true, head, parent };
}

/** `out/` is the cache's plain build for this key: by e2e-build.sh's digest and file by file. */
function cacheProblem(ctx: BundleContext, key: string, files: BundleFile[]): string | null {
  const cache = ctx.env.MAWS_E2E_BUILD_CACHE;
  if (!cache) return 'no MAWS_E2E_BUILD_CACHE: out/ cannot be matched to the gate’s plain build';
  const entry = join(cache, key, 'plain');
  if (!existsSync(join(entry, 'digest'))) return `no plain build in the cache at ${entry}`;
  const stored = readFileSync(join(entry, 'digest'), 'utf8').trim();
  // e2e-build.sh's digest(), the same pipeline
  const digest = ctx.run('/bin/sh', ['-c', 'cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256', 'sh', join(ctx.root, 'out')]).trim().split(/\s+/)[0] ?? '';
  if (digest !== stored) return `out/ (sha256 ${digest}) differs from the cache's plain build (${stored})`;
  const cached = inventory(join(entry, 'out'));
  const mine = new Map(files.map((f) => [f.path, f]));
  const theirs = new Map(cached.map((f) => [f.path, f]));
  const onlyCache = cached.filter((f) => !mine.has(f.path)).map((f) => f.path);
  const onlyOut = files.filter((f) => !theirs.has(f.path)).map((f) => f.path);
  const changed = files.filter((f) => theirs.has(f.path) && theirs.get(f.path)!.sha256 !== f.sha256).map((f) => f.path);
  if (onlyCache.length + onlyOut.length + changed.length === 0) return null;
  return `out/ differs from the cache's plain out/: ${[onlyCache.length > 0 && `only in the cache: ${onlyCache.join(', ')}`, onlyOut.length > 0 && `only in out/: ${onlyOut.join(', ')}`, changed.length > 0 && `changed: ${changed.join(', ')}`].filter(Boolean).join('; ')}`;
}

/** The final bundle, or why a selected run fails; nothing for a run on any other ref. */
export function finalBundle(ctx: BundleContext, run: InvocationSummary, intended: string[] = run.specs): BundleOutcome {
  const ref = selectedRef(ctx.env);
  if (ref === null) return { selected: false };
  const fail = (reason: string): BundleOutcome => ({ selected: true, ok: false, reason });
  const problems = invocationProblems(run, intended);
  if (problems.length > 0) return fail(problems.join('; '));
  let staging: string | null = null;
  try {
    const proven = provenance(ctx, ref);
    if (!proven.ok) return fail(proven.reason);
    const files = inventory(join(ctx.root, 'out'));
    if (files.length === 0) return fail('out/ holds no file');
    const mismatch = cacheProblem(ctx, proven.head, files);
    if (mismatch) return fail(mismatch);

    const results = join(ctx.root, 'test-results');
    mkdirSync(results, { recursive: true });
    staging = join(results, `.bundle-${process.pid}-${Date.now()}`);
    mkdirSync(staging);
    const tgz = join(staging, 'plain.tgz');
    ctx.run('tar', ['--no-mac-metadata', '--no-xattrs', '-czf', tgz, '-C', ctx.root, 'out'], { env: { COPYFILE_DISABLE: '1' } });
    const listed = ctx.run('tar', ['-tzf', tgz]).split('\n').filter((line) => line !== '' && !line.endsWith('/'));
    const want = new Set(files.map((f) => f.path));
    const extra = listed.filter((path) => !want.has(path));
    const missing = files.map((f) => f.path).filter((path) => !listed.includes(path));
    if (extra.length + missing.length > 0 || listed.length !== files.length) return fail(`the archive does not list exactly out/: ${[extra.length > 0 && `extra ${extra.join(', ')}`, missing.length > 0 && `missing ${missing.join(', ')}`, listed.length !== files.length && `${listed.length} entries for ${files.length} files`].filter(Boolean).join('; ')}`);
    const manifest: BundleManifest = { commit: proven.parent, buildCommit: proven.head, variant: 'plain', tgz: 'plain.tgz', sha256: createHash('sha256').update(readFileSync(tgz)).digest('hex'), files };
    writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const bundle = join(results, 'bundle');
    rmSync(bundle, { recursive: true, force: true });
    renameSync(staging, bundle);
    staging = null;
    ctx.log(`design bundle: test-results/bundle/plain.tgz (sha256 ${manifest.sha256}, ${files.length} files of out/) for source ${proven.parent}, built at ${proven.head}`);
    return { selected: true, ok: true, manifest };
  } catch (error) {
    return fail(`the bundle could not be made: ${words(error)}`);
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

/** The command the reporter runs with: in the checkout, its stdout as text. */
export const realCommand =
  (root: string): Command =>
  (file, args, options = {}) =>
    execFileSync(file, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...options.env } });
