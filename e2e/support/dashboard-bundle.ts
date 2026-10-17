// P3-E2 M6 (docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md, M6 "Live build hand-off"; gate-offload Decision Log 50
// with its 14:55Z provenance, 16:52Z schema and 19:57Z selection amendments; P3-E Decision Log 36; E2's execution
// Decision Logs 19, 24 and 31): the dashboard acceptance run's final bundle, what the final reporter
// (./dashboard-final-reporter.ts) does at the end of `pnpm e2e:dashboard`. The architect's one paid live run takes the
// mini's plain `out/` from it instead of building on the MacBook.
//
// Selection. A run whose gate ref starts `ci/e2-final-` (ci-gate.sh `--label e2-final`) is E2's final run by declaration,
// whatever follows the prefix (the ref glob is not narrowed); any other ref leaves the reporter a no-op, whatever the
// outcome. Once selected, every precondition is a check that fails the run with a named reason: the whole declared
// invocation passed (the command line exactly `playwright test --config playwright.dashboard.config.ts`, the config's
// grep, inverse and shard unnarrowed, every declared file at its declared count of cases and no other, every case
// expected, none skipped); on CI; on macOS; HEAD is ci-gate's wrapper (subject `ci-gate: <short>`) with exactly one
// parent and the `Evidence: yes` trailer, and HEAD = GITHUB_SHA = MAWS_E2E_BUILD_KEY; the ref names that parent; the
// parent's commit object is read (fetched at depth 1 when the shallow checkout lacks it, the checkout untouched) and its
// tree equals the wrapper's; `out/` equals the build cache's plain variant for the key, by e2e-build.sh's own digest and
// file by file. Only then is `out/` archived (tar under COPYFILE_DISABLE=1), the archive listed back against the
// inventory, and `test-results/bundle/{plain.tgz, manifest.json}` written in place of any earlier bundle:
//   manifest.json {commit (the gate parent, the source), buildCommit (the mini's checkout), variant: 'plain',
//                  tgz: 'plain.tgz', sha256 (the archive's), files: [{path: 'out/…', bytes, sha256}] in byte order}
// Free of Playwright: git, tar and the digest go through an injected command, so test/support/dashboard-bundle.test.ts
// runs every refusal under vitest. The three children's reporters converge at P3-F (the tracker's reporter row).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';
import { DASHBOARD_ACCEPTANCE, DASHBOARD_CONFIG } from './dashboard-acceptance';

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

type Grep = RegExp | RegExp[];
/** What the run was: its status, its command line, the config's selection and every case with its outcome. */
export interface InvocationSummary {
  /** Playwright's `FullResult.status`. */
  status: string;
  /** The runner's `process.argv`. */
  argv: readonly string[];
  /** The resolved config's selection (`FullConfig.grep`, `grepInvert`, `shard`). */
  config: { grep: Grep; grepInvert: Grep | null; shard: { current: number; total: number } | null };
  /** Every case of the root suite: its spec file's name, its title and its outcome (`expected`, `unexpected`, `flaky`, `skipped`). */
  tests: { file: string; title: string; outcome: string }[];
}

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
export type BundleOutcome = { selected: false } | { selected: true; ok: true; manifest: BundleManifest } | { selected: true; ok: false; reason: string };

const FINAL_REF = /^(?:refs\/heads\/)?(ci\/e2-final-.*)$/;
const SHA = /^[0-9a-f]{40}$/;

/** The reserved final ref this run is on, else null (the reporter does nothing). */
export function selectedRef(env: Record<string, string | undefined>): string | null {
  for (const ref of [env.GITHUB_REF, env.GITHUB_REF_NAME]) {
    const match = ref ? FINAL_REF.exec(ref) : null;
    if (match) return match[1]!;
  }
  return null;
}

/** How the command line narrows the run, as words: empty when it is `playwright test --config <the dashboard config>`. */
function commandLineProblems(argv: readonly string[]): string[] {
  const at = argv.indexOf('test', 2);
  if (at < 0) return ['the invocation is not `playwright test`'];
  const words: string[] = [];
  let config: string | null = null;
  const args = argv.slice(at + 1);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--config' || arg === '-c') {
      config = args[++i] ?? '';
      continue;
    }
    if (arg.startsWith('--config=')) {
      config = arg.slice('--config='.length);
      continue;
    }
    // Anything else narrows or reshapes the run (a grep or its inverse, a file or `file:line` filter, the last
    // failures, the changed files, a test list, a project, a shard, a stop after failures, words after `--`), whatever
    // its alias or spelling: several of them are applied outside the config the reporter sees.
    if (arg.startsWith('-')) words.push(i + 1 < args.length && !args[i + 1]!.startsWith('-') && !arg.includes('=') && !/^(-x|--last-failed|--only-changed|--forbid-only|--list|--pass-with-no-tests)$/.test(arg) ? `${arg} ${args[++i]}` : arg);
    else words.push(`a test file named on the command line: ${arg}`);
  }
  if (config === null) words.unshift(`not run with --config ${DASHBOARD_CONFIG}`);
  else if (resolvePath(config) !== resolvePath(DASHBOARD_CONFIG)) words.unshift(`run with --config ${config}, not ${DASHBOARD_CONFIG}`);
  return words;
}

const unnarrowed = (grep: Grep | null, empty: boolean): boolean => {
  const all = grep === null ? [] : Array.isArray(grep) ? grep : [grep];
  return empty ? all.length === 0 : all.length === 1 && all[0]!.source === '.*' && all[0]!.flags === '';
};

/** Why the run was not the whole declared invocation passed; empty when it was. */
export function invocationProblems(run: InvocationSummary): string[] {
  const problems: string[] = [];
  if (run.status !== 'passed') problems.push(`the run did not pass (${run.status})`);
  for (const word of commandLineProblems(run.argv)) problems.push(`the invocation was narrowed: ${word}`);
  if (!unnarrowed(run.config.grep, false)) problems.push(`the config's grep narrows the run (${String(run.config.grep)})`);
  if (!unnarrowed(run.config.grepInvert, true)) problems.push(`the config's grepInvert narrows the run (${String(run.config.grepInvert)})`);
  if (run.config.shard) problems.push(`the run is shard ${run.config.shard.current}/${run.config.shard.total}`);
  const counts = new Map<string, number>();
  for (const t of run.tests) counts.set(t.file, (counts.get(t.file) ?? 0) + 1);
  for (const { file, tests } of DASHBOARD_ACCEPTANCE) if ((counts.get(file) ?? 0) !== tests) problems.push(`${file}: ${counts.get(file) ?? 0} cases of the declared ${tests}`);
  for (const file of counts.keys()) if (!DASHBOARD_ACCEPTANCE.some((spec) => spec.file === file)) problems.push(`a file outside the declared list ran: ${file}`);
  for (const t of run.tests) {
    if (t.outcome === 'skipped') problems.push(`a skipped case: ${t.file} › ${t.title}`);
    else if (t.outcome !== 'expected') problems.push(`a case not expected (${t.outcome}): ${t.file} › ${t.title}`);
  }
  return problems;
}

/** Every file under `dir` as `out/<relative path>`, in byte order, with its size and sha256; anything but a file refused. */
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
        if (/[\n\\]/.test(relative)) throw new Error(`a file name the manifest cannot carry: ${JSON.stringify(relative)}`);
        const bytes = readFileSync(path);
        files.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      } else throw new Error(`not a regular file: ${relative}`);
    }
  };
  walk(dir, prefix);
  return files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

/** A commit object's tree, parents, subject and trailers. */
function parseCommit(raw: string): { tree: string | null; parents: string[]; subject: string; trailers: string[] } {
  const split = raw.indexOf('\n\n');
  const header = split < 0 ? raw : raw.slice(0, split);
  const message = split < 0 ? '' : raw.slice(split + 2);
  const lines = header.split('\n');
  const paragraphs = message.trim().split(/\n\s*\n/);
  const last = paragraphs.length > 1 ? paragraphs.at(-1)!.split('\n') : [];
  return {
    tree: lines.find((l) => l.startsWith('tree '))?.slice(5).trim() ?? null,
    parents: lines.filter((l) => l.startsWith('parent ')).map((l) => l.slice(7).trim()),
    subject: paragraphs[0]?.split('\n')[0] ?? '',
    // a trailer block is a last paragraph made only of `Key: value` lines
    trailers: last.length > 0 && last.every((l) => /^[A-Za-z][\w-]*: \S/.test(l)) ? last : [],
  };
}

const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0];

/** The checks after the invocation's, or the first that fails, by name. */
function provenance(ctx: BundleContext, ref: string): { ok: true; head: string; parent: string } | { ok: false; reason: string } {
  const { env, run } = ctx;
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true') return { ok: false, reason: `not on CI (CI=${env.CI ?? 'unset'}, GITHUB_ACTIONS=${env.GITHUB_ACTIONS ?? 'unset'})` };
  if (ctx.platform !== 'darwin') return { ok: false, reason: `not on macOS (${ctx.platform})` };
  const head = run('git', ['rev-parse', 'HEAD']).trim();
  if (!SHA.test(head)) return { ok: false, reason: `HEAD is not a commit (${head})` };
  if (head !== env.GITHUB_SHA) return { ok: false, reason: `HEAD ${head} differs from GITHUB_SHA ${env.GITHUB_SHA ?? 'unset'}` };
  if (head !== env.MAWS_E2E_BUILD_KEY) return { ok: false, reason: `HEAD ${head} differs from the build cache key MAWS_E2E_BUILD_KEY ${env.MAWS_E2E_BUILD_KEY ?? 'unset'}` };
  const wrapper = parseCommit(run('git', ['cat-file', 'commit', 'HEAD']));
  if (wrapper.parents.length !== 1) return { ok: false, reason: `the gate commit has ${wrapper.parents.length} parents, not exactly one` };
  const parent = wrapper.parents[0]!;
  if (wrapper.subject !== `ci-gate: ${parent.slice(0, 8)}`) return { ok: false, reason: `HEAD is not ci-gate's wrapper of its parent (subject ${JSON.stringify(wrapper.subject)})` };
  if (!wrapper.trailers.includes('Evidence: yes')) return { ok: false, reason: `no \`Evidence: yes\` trailer on the gate commit (trailers ${JSON.stringify(wrapper.trailers)})` };
  if (ref !== `ci/e2-final-${parent.slice(0, 8)}`) return { ok: false, reason: `the ref ${ref} does not name the gate parent ${parent}` };
  let source: ReturnType<typeof parseCommit>;
  try {
    source = parseCommit(run('git', ['cat-file', 'commit', parent]));
  } catch {
    try {
      ctx.log(`dashboard bundle: the gate parent ${parent} is not in the shallow checkout; fetching that object alone`);
      run('git', ['fetch', '--no-tags', '--depth=1', 'origin', parent]);
      source = parseCommit(run('git', ['cat-file', 'commit', parent]));
    } catch (error) {
      return { ok: false, reason: `the gate parent ${parent} could not be read or fetched: ${firstLine(error)}` };
    }
  }
  if (!wrapper.tree || wrapper.tree !== source.tree) return { ok: false, reason: `the gate commit's tree ${wrapper.tree} differs from its parent's ${source.tree}` };
  return { ok: true, head, parent };
}

/** Why `out/` is not the cache's plain build for this key (by e2e-build.sh's digest and file by file); null when it is. */
function cacheProblem(ctx: BundleContext, key: string, files: BundleFile[]): string | null {
  const cache = ctx.env.MAWS_E2E_BUILD_CACHE;
  if (!cache) return 'no MAWS_E2E_BUILD_CACHE: out/ cannot be matched to the gate’s plain build';
  const entry = join(cache, key, 'plain');
  if (!existsSync(join(entry, 'digest'))) return `no plain build in the cache at ${entry}`;
  const stored = readFileSync(join(entry, 'digest'), 'utf8').trim();
  // e2e-build.sh's digest(), the same pipeline
  const digest = ctx.run('/bin/sh', ['-c', 'cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256', 'sh', join(ctx.root, 'out')]).trim().split(/\s+/)[0] ?? '';
  if (digest !== stored) return `out/ (sha256 ${digest}) differs from the cache's plain build (${stored})`;
  const cached = new Map(inventory(join(entry, 'out')).map((f) => [f.path, f]));
  const mine = new Map(files.map((f) => [f.path, f]));
  const onlyCache = [...cached.keys()].filter((path) => !mine.has(path));
  const onlyOut = [...mine.keys()].filter((path) => !cached.has(path));
  const changed = files.filter((f) => cached.has(f.path) && cached.get(f.path)!.sha256 !== f.sha256).map((f) => f.path);
  if (onlyCache.length + onlyOut.length + changed.length === 0) return null;
  return `out/ differs from the cache's plain out/: ${[onlyCache.length > 0 && `only in the cache: ${onlyCache.join(', ')}`, onlyOut.length > 0 && `only in out/: ${onlyOut.join(', ')}`, changed.length > 0 && `changed: ${changed.join(', ')}`].filter(Boolean).join('; ')}`;
}

/** The final bundle, or why a selected run fails; nothing for a run on any other ref. */
export function finalBundle(ctx: BundleContext, run: InvocationSummary): BundleOutcome {
  const ref = selectedRef(ctx.env);
  if (ref === null) return { selected: false };
  const fail = (reason: string): BundleOutcome => ({ selected: true, ok: false, reason });
  const problems = invocationProblems(run);
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
    ctx.run('tar', ['-czf', tgz, '-C', ctx.root, 'out'], { env: { COPYFILE_DISABLE: '1' } });
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
    ctx.log(`dashboard bundle: test-results/bundle/plain.tgz (sha256 ${manifest.sha256}, ${files.length} files of out/) for source ${proven.parent}, built at ${proven.head}`);
    return { selected: true, ok: true, manifest };
  } catch (error) {
    return fail(`the bundle could not be made: ${firstLine(error)}`);
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

/** A spec file's name as the declared list names it. */
export const specName = (path: string): string => basename(path);

/** The command the reporter runs with: in the checkout, its stdout as text. */
export const realCommand =
  (root: string): Command =>
  (file, args, options = {}) =>
    execFileSync(file, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...options.env } });
