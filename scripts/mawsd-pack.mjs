#!/usr/bin/env node
// `pnpm mawsd:pack` (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8 "The pack", "The Linux runtime and the Node
// floor"): runs `pnpm build:main-preload`, then assembles `dist/mawsd/<version>-<commit>-<content>/`, the package
// `mawsd install` installs as a Linux release (src/mawsd/release.ts). `<content>` is 8 hex of the SHA-256 of everything
// in it but its package.json (each file's path, kind and bytes, in path order), so the release name is its content's:
// the same content is the same release, which an install copies once and never rewrites, and a rebuild of one commit
// that changed anything is another release.
//
//   out/main/**                  main's build, whose second input is mawsd.js (and the host bundles it spawns)
//   node_modules/…               the production closure of the externals the bundle guard allows (zod, the MCP SDK,
//                                node-pty), copied from the installed tree as Node would resolve them
//   bin/maws-session-host        the session host for the pack's platform (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md,
//                                M1): the committed prebuild native/session-host/prebuilds/<platform>-<arch>/, mode 0755;
//                                required on Linux, where every lane B launch runs under it; its `--version` is a
//                                smoke check (M4)
//   package.json                 a minimal one, naming the release ({ mawsd: { release, commit, platform, arch, node } })
//   runtime/                     on Linux only: the pinned Node (packaging/mawsd/node.json), downloaded from nodejs.org,
//                                checked against its sha256 before it is unpacked, and put through the smoke checks
//
// A mismatch, a failed smoke check or a missing dependency refuses the pack and leaves none. The pack's path is the one
// line printed on stdout; the build's output goes to stderr. Options: --out <dir> (default dist/mawsd), --no-build.
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EXTERNALS = ['zod', '@modelcontextprotocol/sdk', 'node-pty']; // src/engine-host/bundle-guard.test.ts's allowed externals
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOWNLOADS = '.downloads';

// Every package directory (relative to `root`) the `names` need at run time: each one and, transitively, its
// `dependencies`, `optionalDependencies` and installed peers, each resolved from the package that needs it as Node
// resolves it (the nearest node_modules up the tree). An optional dependency or peer that is not installed is skipped;
// any other refuses the pack.
export function closure(root, names) {
  const found = new Map(); // real path -> path relative to root
  const visit = (from, name, needer) => {
    const dir = resolvePackage(root, from, name);
    if (dir === null) throw new Error(`${needer} needs ${name}, which is not installed under ${root}`);
    const real = realpathSync(dir);
    if (found.has(real)) return;
    found.set(real, relative(root, dir));
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const optionalPeers = new Set(Object.entries(manifest.peerDependenciesMeta ?? {}).filter(([, meta]) => meta?.optional).map(([peer]) => peer));
    for (const dep of Object.keys(manifest.dependencies ?? {})) visit(dir, dep, name);
    for (const dep of Object.keys(manifest.optionalDependencies ?? {})) if (resolvePackage(root, dir, dep) !== null) visit(dir, dep, name);
    for (const dep of Object.keys(manifest.peerDependencies ?? {})) if (!optionalPeers.has(dep) || resolvePackage(root, dir, dep) !== null) visit(dir, dep, name);
  };
  for (const name of names) visit(root, name, 'mawsd');
  return [...found.values()].sort();
}

function resolvePackage(root, from, name) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === root || !dir.startsWith(root)) return null;
  }
}

function commitOf(root) {
  const head = spawnSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: root, encoding: 'utf8' }); // as electron.vite.config.ts's build stamp
  if (head.status !== 0) throw new Error(`cannot read ${root}'s commit: ${head.stderr.trim()}`);
  return head.stdout.trim();
}

// 8 hex of the SHA-256 of the tree under `dir`: every entry's path relative to it, its kind (file, executable file,
// link) and its bytes or link target, in path order.
export function contentId(dir) {
  const hash = createHash('sha256');
  const walk = (at) => {
    for (const name of readdirSync(join(dir, at)).sort()) {
      const rel = at === '' ? name : `${at}/${name}`;
      const stat = lstatSync(join(dir, rel));
      if (stat.isDirectory()) {
        walk(rel);
      } else if (stat.isSymbolicLink()) {
        hash.update(`l\0${rel}\0${readlinkSync(join(dir, rel))}\0`);
      } else {
        hash.update(`${stat.mode & 0o111 ? 'x' : 'f'}\0${rel}\0${stat.size}\0`);
        hash.update(readFileSync(join(dir, rel)));
      }
    }
  };
  walk('');
  return hash.digest('hex').slice(0, 8);
}

const sha256Of = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function fetchTo(url, to) {
  const response = await globalThis.fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  writeFileSync(to, Buffer.from(await response.arrayBuffer()));
}

// The pinned Node for `target` (`linux-x64`), unpacked into `into` as bin/node and its LICENSE.
async function addRuntime({ into, target, manifestPath, cache, download, log }) {
  const pinned = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sum = pinned.sha256?.[target];
  if (typeof sum !== 'string') throw new Error(`${manifestPath} has no pinned Node runtime for ${target}`);
  const file = `node-v${pinned.version}-${target}.tar.gz`;
  const archive = join(cache, file);
  mkdirSync(cache, { recursive: true });
  if (existsSync(archive) && sha256Of(archive) !== sum) rmSync(archive); // a damaged cache is fetched again
  if (!existsSync(archive)) {
    const url = `https://nodejs.org/dist/v${pinned.version}/${file}`;
    log(`mawsd:pack: downloading ${url}`);
    const partial = `${archive}.${process.pid}.part`;
    await download(url, partial);
    const got = sha256Of(partial);
    if (got !== sum) {
      rmSync(partial, { force: true });
      throw new Error(`refused: ${file} has sha256 ${got}, not the pinned ${sum} (${manifestPath})`);
    }
    renameSync(partial, archive);
  }
  const unpacked = mkdtempSync(join(cache, 'unpack-'));
  try {
    const top = `node-v${pinned.version}-${target}`;
    const tar = spawnSync('tar', ['-xzf', archive, '-C', unpacked, `${top}/bin/node`, `${top}/LICENSE`], { encoding: 'utf8' });
    if (tar.status !== 0) throw new Error(`cannot unpack ${archive}: ${tar.stderr.trim()}`);
    mkdirSync(join(into, 'bin'), { recursive: true });
    renameSync(join(unpacked, top, 'bin', 'node'), join(into, 'bin', 'node'));
    renameSync(join(unpacked, top, 'LICENSE'), join(into, 'LICENSE'));
  } finally {
    rmSync(unpacked, { recursive: true, force: true });
  }
  return pinned.version;
}

// P5 O16 M1: the session host's prebuild for the pack's platform into bin/, executable. A Linux pack refuses without it;
// elsewhere (a Mac's pack, which never installs) a missing one is left out.
function addSessionHost({ root, into, platform, arch }) {
  const prebuild = join(root, 'native', 'session-host', 'prebuilds', `${platform}-${arch}`, 'maws-session-host');
  if (!existsSync(prebuild)) {
    if (platform === 'linux') throw new Error(`no session host prebuild for linux-${arch} (${prebuild}; pnpm build:session-host)`);
    return;
  }
  mkdirSync(join(into, 'bin'), { recursive: true });
  cpSync(prebuild, join(into, 'bin', 'maws-session-host'));
  chmodSync(join(into, 'bin', 'maws-session-host'), 0o755);
}

// P5 O16 M4: the pack's session host answers `--version` with the version and protocol major the engine host it ships
// beside expects (src/engine-host/holder/protocol.ts), so a stale or foreign prebuild refuses the pack.
function smokeSessionHost({ root, pack }) {
  const binary = join(pack, 'bin', 'maws-session-host');
  if (!existsSync(binary)) return;
  const source = readFileSync(join(root, 'src', 'engine-host', 'holder', 'protocol.ts'), 'utf8');
  const constant = (name) => {
    const found = new RegExp(`export const ${name} = '?([0-9.]+)'?;`).exec(source);
    if (!found) throw new Error(`src/engine-host/holder/protocol.ts declares no ${name}`);
    return found[1];
  };
  const expected = `maws-session-host ${constant('SESSION_HOST_VERSION')} protocol ${constant('SESSION_HOST_PROTOCOL')}`;
  const ran = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  if (ran.status !== 0) throw new Error(`smoke check session host failed (${ran.status ?? ran.signal ?? ran.error?.message}): ${(ran.stderr || ran.stdout || '').trim()}`);
  const out = ran.stdout.trim();
  if (out !== expected) throw new Error(`smoke check session host printed ${JSON.stringify(out)}, not ${JSON.stringify(expected)}`);
}

// The smoke checks, with the runtime: its version is the pin; `node:sqlite` loads without a flag; `--disable-sigusr1`
// is accepted; a .ts file importing another by its .ts extension runs under default type stripping (residue 23); and
// node-pty's addon, as the pack carries it, loads.
function smoke({ node, version, pack }) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const scratch = mkdtempSync(join(tmpdir(), 'mawsd-pack-smoke-'));
  try {
    writeFileSync(join(scratch, 'a.ts'), 'export const x: number = 1;\n');
    writeFileSync(join(scratch, 'b.ts'), 'import { x } from "./a.ts"; console.log(x);\n');
    const checks = [
      ['version', ['-p', 'process.versions.node'], version],
      ['node:sqlite', ['-e', "require('node:sqlite')"], null],
      ['--disable-sigusr1', ['--disable-sigusr1', '-e', '0'], null],
      ['type stripping', [join(scratch, 'b.ts')], '1'],
      ['node-pty', ['-e', 'require(process.argv[1])', join(pack, 'node_modules', 'node-pty')], null],
    ];
    for (const [name, args, expected] of checks) {
      const ran = spawnSync(node, args, { cwd: scratch, env, encoding: 'utf8', timeout: 30_000 });
      if (ran.status !== 0) throw new Error(`smoke check ${name} failed (${ran.status ?? ran.signal}): ${(ran.stderr || ran.stdout || String(ran.error ?? '')).trim()}`);
      const out = ran.stdout.trim();
      if (expected !== null && out !== expected) throw new Error(name === 'version' ? `the runtime is Node ${out}, not the pinned ${version}` : `smoke check ${name} printed ${JSON.stringify(out)}, not ${JSON.stringify(expected)}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function pack({
  root = REPO,
  out = join(root, 'dist', 'mawsd'),
  platform = process.platform,
  arch = process.arch,
  commit = commitOf(root),
  build = true,
  manifest = join(root, 'packaging', 'mawsd', 'node.json'),
  download = fetchTo,
  log = (line) => process.stderr.write(`${line}\n`),
} = {}) {
  if (build) {
    const built = spawnSync('pnpm', ['build:main-preload'], { cwd: root, stdio: ['ignore', 2, 2] });
    if (built.status !== 0) throw new Error(`pnpm build:main-preload failed (${built.status ?? built.signal})`);
  }
  if (!existsSync(join(root, 'out', 'main', 'mawsd.js'))) throw new Error(`${root}/out/main/mawsd.js is not built`);
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  mkdirSync(out, { recursive: true });
  const staged = mkdtempSync(join(out, '.staging.'));
  let release;
  try {
    cpSync(join(root, 'out', 'main'), join(staged, 'out', 'main'), { recursive: true });
    for (const dir of closure(root, EXTERNALS)) {
      // each package without its own node_modules: what it needs from there is in the closure, under its own path
      const from = join(root, dir);
      cpSync(from, join(staged, dir), { recursive: true, filter: (path) => relative(from, path).split('/')[0] !== 'node_modules' });
    }
    let node = null;
    if (platform === 'linux') {
      node = await addRuntime({ into: join(staged, 'runtime'), target: `linux-${arch}`, manifestPath: manifest, cache: join(out, DOWNLOADS), download, log });
      smoke({ node: join(staged, 'runtime', 'bin', 'node'), version: node, pack: staged });
    }
    addSessionHost({ root, into: staged, platform, arch });
    smokeSessionHost({ root, pack: staged });
    release = `${version}-${commit}-${contentId(staged)}`;
    const packageJson = { name: 'maws-mawsd', version, private: true, main: 'out/main/mawsd.js', mawsd: { release, commit, platform, arch, node } };
    writeFileSync(join(staged, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
    // the output directory holds this pack alone (and the download cache)
    for (const name of readdirSync(out)) if (name !== DOWNLOADS && join(out, name) !== staged) rmSync(join(out, name), { recursive: true, force: true });
    renameSync(staged, join(out, release));
  } catch (error) {
    rmSync(staged, { recursive: true, force: true });
    throw error;
  }
  log(`mawsd:pack: ${join(out, release)}${platform === 'linux' ? '' : ' (no runtime/: one is added on Linux only)'}`);
  return join(out, release);
}

function options(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--no-build') parsed.build = false;
    else if (argv[i] === '--out' && argv[i + 1]) parsed.out = resolve(argv[++i]);
    else throw new Error(`mawsd:pack does not take ${argv[i]}; usage: mawsd-pack.mjs [--out <dir>] [--no-build]`);
  }
  return parsed;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  pack(options(process.argv.slice(2))).then(
    (at) => process.stdout.write(`${at}\n`),
    (error) => {
      process.stderr.write(`mawsd:pack: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
