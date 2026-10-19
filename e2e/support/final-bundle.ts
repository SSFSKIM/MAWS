// The build a paid live run uses, carried as a final gate run's evidence (gate-offload Decision Log 50, its 14:55Z
// provenance, 16:52Z schema and 19:57Z selection; P3-F converged the three children's writers here, the tracker's
// reporter row). A live run happens on the architect's MacBook from the `out/` a final acceptance run on the Mac mini
// built, never from a local build: this module writes that `out/` into the run's evidence as
// `test-results/bundle/<variant>.tgz` beside `manifest.json`:
//   {commit, buildCommit, variant: 'plain' | 'harness', tgz: '<variant>.tgz', sha256 (of the archive),
//    files: [{path, bytes, sha256}] sorted by path, one entry per file of out/, each path `out/…`}
// Selection: a run whose ref (GITHUB_REF or GITHUB_REF_NAME) starts `ci/<label>-` for one of the reporter's reserved
// labels is that label's final run by declaration, whatever follows (so a mistyped final ref fails rather than passing
// without a bundle); any other ref leaves everything as it was. Once selected, the build must be proven the source's,
// and anything unproven fails the run, in this order:
//   - on CI (`CI=true`, `GITHUB_ACTIONS=true`) on macOS;
//   - HEAD equal to GITHUB_SHA and to the build cache's key (MAWS_E2E_BUILD_KEY, the commit scripts/e2e-build.sh built);
//   - HEAD is ci-gate.sh's wrapper: exactly one parent, the subject `ci-gate: <parent's short sha>`, a closing trailer
//     block carrying `Evidence: yes`; the ref names that parent's short sha; the parent's commit object (fetched by its
//     sha when the shallow checkout lacks it) has the wrapper's tree;
//   - the current out/ is the cache's out/ of the variant, by the digest the cache stored and file by file.
// `commit` is that parent (the source HEAD the architect's worktree must hold), `buildCommit` the wrapper. Whether the
// whole invocation passed is the reporter's to decide (./final-bundle-reporter.ts, ./final-invocation.ts); this module
// is free of Playwright so test/support/final-bundle.test.ts runs it under vitest over scratch repositories and files.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type BundleVariant = 'plain' | 'harness';

export interface BundleFile {
  path: string; // `out/<relative path>`, POSIX separators
  bytes: number;
  sha256: string;
}

export interface BundleManifest {
  commit: string;
  buildCommit: string;
  variant: BundleVariant;
  tgz: string;
  sha256: string;
  files: BundleFile[];
}

export interface FinalBundleRequest {
  labels: readonly string[]; // the reserved gate labels the run answers to, e.g. `e2-final` and `p3f-final`
  variant: BundleVariant;
  root: string; // the checkout: its git repository and its out/
  bundleDir: string; // where the archive and the manifest go (`test-results/bundle`)
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  log(line: string): void;
}

// Not this run's to bundle: any ref but a reserved one. Nothing is written and nothing fails.
export class NotFinalRun extends Error {}

const LABEL = /^[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

// Every regular file under `dir`, path-sorted by bytes (as `LC_ALL=C sort` orders them), each path prefixed `prefix`.
// Anything else (a symlink, a socket), or a name the digest's lines cannot carry, refuses: the archive, the inventory
// and the digest must say the same thing.
export function inventory(dir: string, prefix = 'out/'): BundleFile[] {
  const files: BundleFile[] = [];
  const walk = (at: string, rel: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const relative = rel === '' ? name : `${rel}/${name}`;
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path, relative);
      else if (stat.isFile()) {
        if (/[\n\\]/.test(relative)) throw new Error(`${prefix}${JSON.stringify(relative)} is a name the digest cannot carry`);
        const bytes = readFileSync(path);
        files.push({ path: `${prefix}${relative}`, bytes: bytes.length, sha256: sha256(bytes) });
      } else throw new Error(`${prefix}${relative} is not a regular file or a directory`);
    }
  };
  walk(dir, '');
  return files.sort((a, b) => byBytes(a.path, b.path));
}

// scripts/e2e-build.sh's `digest`: `find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256`.
export function cacheDigest(files: readonly BundleFile[], prefix = 'out/'): string {
  return sha256(files.map((file) => `${file.sha256}  ./${file.path.slice(prefix.length)}\n`).join(''));
}

// A raw commit object's tree, parents, subject and closing trailer block (a last paragraph made only of `Key: value`
// lines, as ci-gate.sh writes its trailers; none when the message has one paragraph).
export function parseCommit(raw: string): { tree: string; parents: string[]; subject: string; trailers: string[] } {
  const split = raw.indexOf('\n\n');
  const headers = (split === -1 ? raw : raw.slice(0, split)).split('\n');
  const paragraphs = (split === -1 ? '' : raw.slice(split + 2)).trim().split(/\n\s*\n/);
  const last = paragraphs.length > 1 ? paragraphs.at(-1)!.split('\n') : [];
  return {
    tree: headers.find((line) => line.startsWith('tree '))?.slice(5) ?? '',
    parents: headers.filter((line) => line.startsWith('parent ')).map((line) => line.slice(7)),
    subject: paragraphs[0]?.split('\n')[0] ?? '',
    trailers: last.length > 0 && last.every((line) => /^[A-Za-z][\w-]*: \S/.test(line)) ? last : [],
  };
}

const git = (root: string, args: string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0];

// The reserved final ref this run is on and the label it answers to, else null (the run is not this reporter's).
export function selectedRef(labels: readonly string[], env: Record<string, string | undefined>): { label: string; ref: string } | null {
  for (const label of labels) if (!LABEL.test(label)) throw new Error(`the reserved label ${label} is not a ref name`);
  for (const value of [env.GITHUB_REF, env.GITHUB_REF_NAME]) {
    const ref = value?.replace(/^refs\/heads\//, '');
    const label = ref === undefined ? undefined : labels.find((l) => ref.startsWith(`ci/${l}-`));
    if (label !== undefined) return { label, ref: ref! };
  }
  return null;
}

// The source commit a final run's wrapper stands on, proven (the list above); throws why it cannot be.
export function provenance(request: Pick<FinalBundleRequest, 'root' | 'env' | 'platform' | 'log'>, selected: { label: string; ref: string }): { commit: string; buildCommit: string } {
  const { env, root } = request;
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true') throw new Error(`the final ref ${selected.ref} runs off CI (CI=${env.CI ?? 'unset'}, GITHUB_ACTIONS=${env.GITHUB_ACTIONS ?? 'unset'})`);
  if (request.platform !== 'darwin') throw new Error(`the final ref ${selected.ref} runs on ${request.platform}, not macOS`);
  const head = git(root, ['rev-parse', 'HEAD']);
  if (head !== env.GITHUB_SHA) throw new Error(`HEAD ${head} is not GITHUB_SHA ${env.GITHUB_SHA ?? '(unset)'}`);
  if (head !== env.MAWS_E2E_BUILD_KEY) throw new Error(`HEAD ${head} is not the build cache's key MAWS_E2E_BUILD_KEY ${env.MAWS_E2E_BUILD_KEY ?? '(unset)'}`);
  const wrapper = parseCommit(git(root, ['cat-file', 'commit', head]));
  if (wrapper.parents.length !== 1) throw new Error(`${head} has ${wrapper.parents.length} parents, not ci-gate.sh's one`);
  const parent = wrapper.parents[0]!;
  if (!SHA.test(parent)) throw new Error(`${head}'s parent ${parent} is not a sha`);
  if (wrapper.subject !== `ci-gate: ${parent.slice(0, 8)}`) throw new Error(`${head} is not ci-gate.sh's wrapper of its parent (subject ${JSON.stringify(wrapper.subject)})`);
  if (!wrapper.trailers.includes('Evidence: yes')) throw new Error(`${head} has no "Evidence: yes" in its trailers (${JSON.stringify(wrapper.trailers)})`);
  if (selected.ref !== `ci/${selected.label}-${parent.slice(0, 8)}`) throw new Error(`the ref ${selected.ref} does not name the parent ${parent}`);
  let source: string;
  try {
    source = git(root, ['cat-file', 'commit', parent]);
  } catch {
    request.log(`final bundle: fetching the parent ${parent} (a shallow checkout)`);
    try {
      git(root, ['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', parent]);
      source = git(root, ['cat-file', 'commit', parent]);
    } catch (error) {
      throw new Error(`the parent ${parent} could not be read or fetched: ${firstLine(error)}`, { cause: error });
    }
  }
  const parentTree = parseCommit(source).tree;
  if (parentTree === '' || parentTree !== wrapper.tree) throw new Error(`the wrapper's tree ${wrapper.tree} is not its parent's ${parentTree}`);
  return { commit: parent, buildCommit: head };
}

// Why out/ is not the cache's `variant` build for `key`, by the digest the cache stored and file by file; null when it is.
function cacheProblem(env: Record<string, string | undefined>, key: string, variant: BundleVariant, files: BundleFile[]): string | null {
  const cache = env.MAWS_E2E_BUILD_CACHE;
  if (!cache) return 'MAWS_E2E_BUILD_CACHE is unset: no cached build to compare out/ with';
  const entry = join(cache, key, variant);
  let stored: string;
  let cached: BundleFile[];
  try {
    stored = readFileSync(join(entry, 'digest'), 'utf8').trim();
    cached = inventory(join(entry, 'out'));
  } catch (error) {
    return `no ${variant} build in the cache at ${entry}: ${firstLine(error)}`;
  }
  const digest = cacheDigest(files);
  if (digest !== stored) return `out/ (digest ${digest}) does not match the digest the cache stored (${stored})`;
  const theirs = new Map(cached.map((f) => [f.path, f.sha256]));
  const mine = new Map(files.map((f) => [f.path, f.sha256]));
  const onlyCache = cached.filter((f) => !mine.has(f.path)).map((f) => f.path);
  const onlyOut = files.filter((f) => !theirs.has(f.path)).map((f) => f.path);
  const changed = files.filter((f) => theirs.has(f.path) && theirs.get(f.path) !== f.sha256).map((f) => f.path);
  if (onlyCache.length + onlyOut.length + changed.length === 0) return null;
  const parts = [onlyCache.length > 0 && `only in the cache: ${onlyCache.join(', ')}`, onlyOut.length > 0 && `only in out/: ${onlyOut.join(', ')}`, changed.length > 0 && `changed: ${changed.join(', ')}`];
  return `out/ is not the cache's ${variant} build: ${parts.filter(Boolean).join('; ')}`;
}

// The bundle, written and answered; throws NotFinalRun on any other ref, and why when the run is final but its build
// cannot be proven the source's. The archive and manifest are staged beside the bundle and moved into place together,
// in place of any earlier bundle, so a refusal leaves no partial bundle.
export function writeFinalBundle(request: FinalBundleRequest): BundleManifest {
  const selected = selectedRef(request.labels, request.env);
  if (selected === null) throw new NotFinalRun(`the ref ${request.env.GITHUB_REF_NAME || request.env.GITHUB_REF || '(none)'} is not ci/<${request.labels.join('|')}>-<sha>`);
  const { commit, buildCommit } = provenance(request, selected);
  const files = inventory(join(request.root, 'out'));
  if (files.length === 0) throw new Error('out/ holds no file');
  const mismatch = cacheProblem(request.env, buildCommit, request.variant, files);
  if (mismatch) throw new Error(mismatch);

  mkdirSync(dirname(request.bundleDir), { recursive: true });
  const staging = `${request.bundleDir}.staging-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  try {
    const tgz = `${request.variant}.tgz`;
    const archive = join(staging, tgz);
    // COPYFILE_DISABLE and --no-xattrs: macOS tar adds no AppleDouble `._` entries and no extended attributes, so the
    // archive holds out/ and nothing else
    execFileSync('tar', ['--no-xattrs', '-czf', archive, '-C', request.root, 'out'], { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter((line) => line !== '' && !line.endsWith('/'))
      .map((line) => line.replace(/^\.\//, ''))
      .sort(byBytes);
    if (JSON.stringify(listed) !== JSON.stringify(files.map((file) => file.path))) throw new Error(`the archive does not hold exactly the files of out/ (${listed.length} entries for ${files.length} files)`);
    const manifest: BundleManifest = { commit, buildCommit, variant: request.variant, tgz, sha256: sha256(readFileSync(archive)), files };
    writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    rmSync(request.bundleDir, { recursive: true, force: true });
    renameSync(staging, request.bundleDir);
    request.log(`final bundle: ${join(request.bundleDir, tgz)} (${files.length} files, sha256 ${manifest.sha256}) for ${commit}, built at ${buildCommit}`);
    return manifest;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
