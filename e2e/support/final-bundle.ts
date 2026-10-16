// The build a child's paid live run uses, carried as evidence (gate-offload Decision Log 50, schema fixed 16:52Z). A
// child's single live run happens on the architect's MacBook from the `out/` its final acceptance run on the Mac mini
// built, never from a local build: this module writes that `out/` into the run's evidence as
// `test-results/bundle/<variant>.tgz` beside `manifest.json`:
//   {commit, buildCommit, variant: 'plain' | 'harness', tgz: '<variant>.tgz', sha256 (of the archive),
//    files: [{path, bytes, sha256}] sorted by path, one entry per file of out/, each path `out/…`}
// The child's reserved ref `ci/<label>-<short>` (ci-gate.sh's `--label`) alone selects the final run; on it the bundle is
// written only after proving the build is the source's, and anything unproven fails the run:
//   - on CI (`CI=true`) on macOS;
//   - HEAD equal to GITHUB_SHA and to the build cache's key (MAWS_E2E_BUILD_KEY, the commit scripts/e2e-build.sh built);
//   - HEAD is ci-gate.sh's wrapper: its commit object carries the `Evidence: yes` trailer and exactly one parent, the
//     source commit (read from the object, which a shallow checkout keeps; the parent itself is fetched by its sha when
//     absent), whose short sha the ref names and whose tree is the wrapper's tree;
//   - the current out/ is, file for file, the cache's out/ of the variant, and matches the digest the cache stored.
// `commit` is that parent (the source HEAD the architect's worktree must hold), `buildCommit` the wrapper. Whether the
// whole invocation passed is the reporter's to decide (./final-bundle-reporter.ts); this module is free of Playwright
// so test/support/final-bundle.test.ts runs it under vitest over scratch repositories and files.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  label: string; // the child's reserved gate label, e.g. `h-final`
  variant: BundleVariant;
  root: string; // the checkout: its git repository and its out/
  bundleDir: string; // where the archive and the manifest go (`test-results/bundle`)
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  log(line: string): void;
}

// Not this run's to bundle: any ref but the reserved one. Nothing is written and nothing fails.
export class NotFinalRun extends Error {}

const LABEL = /^[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

// Every regular file under `dir`, path-sorted by bytes (as `LC_ALL=C sort` orders them), each path prefixed `prefix`.
// Anything else (a symlink, a socket) refuses: the archive and the inventory must say the same thing.
export function inventory(dir: string, prefix = 'out/'): BundleFile[] {
  const files: BundleFile[] = [];
  const walk = (at: string, rel: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const relative = rel === '' ? name : `${rel}/${name}`;
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path, relative);
      else if (stat.isFile()) {
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

// The last `key:` line of a commit message, as .github/scripts/gate-plan.mjs reads its trailers.
export function trailer(message: string, key: string): string | undefined {
  return message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith(`${key.toLowerCase()}:`))
    .at(-1)
    ?.slice(key.length + 1)
    .trim();
}

// A raw commit object's tree, parents and message.
export function parseCommit(raw: string): { tree: string; parents: string[]; message: string } {
  const split = raw.indexOf('\n\n');
  const headers = (split === -1 ? raw : raw.slice(0, split)).split('\n');
  const tree = headers.find((line) => line.startsWith('tree '))?.slice(5) ?? '';
  return { tree, parents: headers.filter((line) => line.startsWith('parent ')).map((line) => line.slice(7)), message: split === -1 ? '' : raw.slice(split + 2) };
}

const git = (root: string, args: string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hasObject = (root: string, sha: string): boolean => {
  try {
    git(root, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

// The source commit a final run's wrapper stands on, proven (the list above); throws why it cannot be.
export function provenance(request: Pick<FinalBundleRequest, 'label' | 'root' | 'env' | 'log'>): { commit: string; buildCommit: string } {
  const { env, root } = request;
  const head = git(root, ['rev-parse', 'HEAD']);
  if (head !== env.GITHUB_SHA) throw new Error(`HEAD ${head} is not GITHUB_SHA ${env.GITHUB_SHA ?? '(unset)'}`);
  if (head !== env.MAWS_E2E_BUILD_KEY) throw new Error(`HEAD ${head} is not the build cache's key ${env.MAWS_E2E_BUILD_KEY ?? '(unset)'}`);
  const wrapper = parseCommit(git(root, ['cat-file', 'commit', head]));
  if (trailer(wrapper.message, 'Evidence')?.toLowerCase() !== 'yes') throw new Error(`${head} has no "Evidence: yes" trailer`);
  if (wrapper.parents.length !== 1) throw new Error(`${head} has ${wrapper.parents.length} parents, not ci-gate.sh's one`);
  const parent = wrapper.parents[0]!;
  if (!SHA.test(parent)) throw new Error(`${head}'s parent ${parent} is not a sha`);
  const short = /-([0-9a-f]{8})$/.exec(env.GITHUB_REF_NAME ?? '')?.[1];
  if (short !== parent.slice(0, 8)) throw new Error(`the ref ${env.GITHUB_REF_NAME} does not name the parent ${parent}`);
  if (!hasObject(root, parent)) {
    request.log(`final bundle: fetching the parent ${parent} (a shallow checkout)`);
    git(root, ['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', parent]);
  }
  const parentTree = parseCommit(git(root, ['cat-file', 'commit', parent])).tree;
  if (parentTree === '' || parentTree !== wrapper.tree) throw new Error(`the wrapper's tree ${wrapper.tree} is not its parent's ${parentTree}`);
  return { commit: parent, buildCommit: head };
}

// Whether this run is the child's final run: its reserved ref alone selects it (Decision Log 50, amended 19:57Z), so a
// selected run whose other preconditions fail is a failure, never a silent pass without a bundle.
export function isFinalRef(label: string, env: Record<string, string | undefined>): boolean {
  if (!LABEL.test(label)) throw new Error(`the reserved label ${label} is not a ref name`);
  return new RegExp(`^ci/${label.replaceAll('.', '\\.')}-[0-9a-f]{8}$`).test(env.GITHUB_REF_NAME ?? '');
}

// The final run's own place: on CI, on macOS (throws why not).
export function finalRun(request: Pick<FinalBundleRequest, 'label' | 'env' | 'platform'>): void {
  if (!isFinalRef(request.label, request.env)) throw new NotFinalRun(`the ref ${request.env.GITHUB_REF_NAME || '(none)'} is not ci/${request.label}-<sha>`);
  if (request.env.CI !== 'true') throw new Error(`the final ref ${request.env.GITHUB_REF_NAME} runs off CI (CI=${request.env.CI ?? 'unset'})`);
  if (request.platform !== 'darwin') throw new Error(`the final ref ${request.env.GITHUB_REF_NAME} runs on ${request.platform}, not macOS`);
}

// The bundle, written and answered; throws when the run is final but its build cannot be proven the source's.
export function writeFinalBundle(request: FinalBundleRequest): BundleManifest {
  finalRun(request);
  const { commit, buildCommit } = provenance(request);
  const out = join(request.root, 'out');
  const files = inventory(out);
  if (files.length === 0) throw new Error('out/ is empty');
  const cache = request.env.MAWS_E2E_BUILD_CACHE;
  if (!cache) throw new Error('MAWS_E2E_BUILD_CACHE is unset: no cached build to compare out/ with');
  const entry = join(cache, buildCommit, request.variant);
  const cached = inventory(join(entry, 'out'));
  if (JSON.stringify(cached) !== JSON.stringify(files)) throw new Error(`out/ is not the cache's ${request.variant} build at ${entry}`);
  const stored = readFileSync(join(entry, 'digest'), 'utf8').trim();
  if (cacheDigest(files) !== stored) throw new Error(`out/ does not match the digest the cache stored (${stored})`);

  rmSync(request.bundleDir, { recursive: true, force: true });
  mkdirSync(request.bundleDir, { recursive: true });
  const tgz = `${request.variant}.tgz`;
  const archive = join(request.bundleDir, tgz);
  // COPYFILE_DISABLE: macOS tar adds no AppleDouble `._` entries, so the archive holds out/ and nothing else
  execFileSync('tar', ['-czf', archive, '-C', request.root, 'out'], { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter((line) => line !== '' && !line.endsWith('/'))
    .map((line) => line.replace(/^\.\//, ''))
    .sort(byBytes);
  if (JSON.stringify(listed) !== JSON.stringify(files.map((file) => file.path))) throw new Error('the archive does not hold exactly the files of out/');
  const manifest: BundleManifest = { commit, buildCommit, variant: request.variant, tgz, sha256: sha256(readFileSync(archive)), files };
  writeFileSync(join(request.bundleDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  request.log(`final bundle: ${archive} (${files.length} files, sha256 ${manifest.sha256}) for ${commit}, built at ${buildCommit}`);
  return manifest;
}
