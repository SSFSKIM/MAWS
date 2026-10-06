// (6): builds the packaged driver in three variants, packs each into an asar with @electron/asar (electron-builder's
// packer), runs Electron on the asar, and records what happened. Variants:
//   bundled            playwright-core in no `dependencies`: electron-vite bundles it into out/main/index.js
//   external           playwright-core in `dependencies`: externalised, node_modules/playwright-core copied into the asar
//   external-unpacked  the same, with node_modules/playwright-core left outside the asar (electron-builder's asarUnpack)
// Node script: node spikes/browser-probe/pass2/pack/run.mjs   (through the load gate and a slot)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const probeRoot = join(here, '..', '..');
const nodeModules = join(probeRoot, 'node_modules');
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const electronBin = join(nodeModules, 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const electronVite = join(nodeModules, 'electron-vite', 'bin', 'electron-vite.js');
const scratch = '/tmp/maws-e4-0/pack';
const resultsDir = join(probeRoot, 'results', 'pass2');
const only = process.argv.slice(2);

// ws's optional native accelerators (bufferutil, utf-8-validate) are not installed; Vite stubs a missing optional peer
// dependency as an empty module (`__viteOptionalPeerDep_bufferutil_ws_true = {}`) instead of leaving a require that
// throws, so ws's try/require "succeeds" and its JS fallback is never installed: the bundled ws then throws
// "bufferUtil.unmask is not a function" on the first frame of 32 bytes or more. Externalising the two names restores a
// throwing require. Bundling playwright-core fails at Rollup on its optional dynamic import of `kerberos`
// (lib/utilsBundle.js) unless that name is externalised too.
const WS_NATIVES = ['bufferutil', 'utf-8-validate'];
const variants = [
  { name: 'external-ws-natives-bundled', dependencies: { 'playwright-core': '1.63.0' }, copy: ['playwright-core'], extraExternal: [], note: 'the failure: ws bundled with its natives' },
  { name: 'bundled-plain', dependencies: {}, extraExternal: WS_NATIVES, buildOnly: true, note: 'the failure: playwright-core bundled with nothing externalised (Rollup stops on kerberos)' },
  { name: 'bundled', dependencies: {}, extraExternal: ['kerberos', ...WS_NATIVES] },
  { name: 'external', dependencies: { 'playwright-core': '1.63.0' }, copy: ['playwright-core'], extraExternal: WS_NATIVES },
  { name: 'external-unpacked', dependencies: { 'playwright-core': '1.63.0' }, copy: ['playwright-core'], unpackDir: 'node_modules/playwright-core', extraExternal: WS_NATIVES },
];

function sizeOf(path) {
  if (!existsSync(path)) return null;
  const st = statSync(path);
  if (st.isFile()) return st.size;
  let total = 0;
  for (const f of require('node:fs').readdirSync(path)) total += sizeOf(join(path, f)) ?? 0;
  return total;
}
const kb = (n) => (n == null ? null : Math.round(n / 1024));

async function runVariant(v) {
  const r = { name: v.name, dependencies: v.dependencies, note: v.note };
  const root = join(scratch, v.name, 'root');
  const stage = join(scratch, v.name, 'stage');
  const asarPath = join(scratch, v.name, 'app.asar');
  rmSync(join(scratch, v.name), { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: `maws-probe-pack-${v.name}`, version: '0.0.0', private: true, main: 'out/main/index.js', dependencies: v.dependencies }, null, 2));
  // electron-vite bundles the config file into the root and imports it from there, so the root needs a node_modules
  // that resolves `electron-vite` (a symlink to the shared one; the stage copies real files).
  symlinkSync(nodeModules, join(root, 'node_modules'));

  // build
  const t0 = performance.now();
  const build = spawnSync(process.execPath, [electronVite, 'build', root, '-c', join(here, 'electron.vite.config.mjs'), '--outDir', 'out'], { cwd: root, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, PROBE_PACK_EXTERNAL: (v.extraExternal ?? []).join(',') }, timeout: 180000, killSignal: 'SIGKILL' });
  r.build = { ms: Math.round(performance.now() - t0), status: build.status, extraExternal: v.extraExternal ?? [], stdoutTail: (build.stdout ?? '').split('\n').filter(Boolean).slice(-12), stderr: (build.stderr ?? '').split('\n').filter((l) => l && !/^\s+at /.test(l)).slice(0, 30), bundleKB: kb(sizeOf(join(root, 'out', 'main', 'index.js'))) };
  if (build.status !== 0 || v.buildOnly) return r;
  const bundle = readFileSync(join(root, 'out', 'main', 'index.js'), 'utf8');
  const builtins = new Set(require('node:module').builtinModules);
  r.build.requiresLeftInBundle = [...new Set([...bundle.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)].map((m) => m[2]))].filter((s) => !s.startsWith('node:') && !builtins.has(s) && s !== 'electron').slice(0, 40);
  r.build.dynamicRequireCalls = (bundle.match(/\brequire\((?!['"])/g) ?? []).length;
  r.build.mentionsDirname = (bundle.match(/__dirname/g) ?? []).length;
  r.build.bundlesPlaywrightCore = /playwright-core\/lib|playwrightImpl|connectOverCDP\s*[:(]/.test(bundle) && !/require\(["']playwright-core["']\)/.test(bundle);

  // stage and pack
  mkdirSync(stage, { recursive: true });
  cpSync(join(root, 'package.json'), join(stage, 'package.json'));
  cpSync(join(root, 'out'), join(stage, 'out'), { recursive: true });
  for (const dep of v.copy ?? []) cpSync(join(nodeModules, dep), join(stage, 'node_modules', dep), { recursive: true, dereference: true });
  const t1 = performance.now();
  await asar.createPackageWithOptions(stage, asarPath, v.unpackDir ? { unpackDir: v.unpackDir } : {});
  r.pack = { ms: Math.round(performance.now() - t1), asarKB: kb(sizeOf(asarPath)), unpackedKB: kb(sizeOf(`${asarPath}.unpacked`)), stagedNodeModulesKB: kb(sizeOf(join(stage, 'node_modules'))) };

  // run from the asar
  const resultFile = join(scratch, v.name, 'result.json');
  const t2 = performance.now();
  // SIGKILL on timeout: Electron with its uncaught-exception dialog up ignores SIGTERM (a first run hung for 11 minutes)
  const run = spawnSync(electronBin, [asarPath], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, PROBE_PACK_RESULT: resultFile }, timeout: 40000, killSignal: 'SIGKILL' });
  r.run = { ms: Math.round(performance.now() - t2), status: run.status, signal: run.signal, stderr: (run.stderr ?? '').split('\n').filter((l) => l && !/Secure coding|NSWindow|CoreText|objc\[/.test(l)).slice(0, 20), stdout: (run.stdout ?? '').split('\n').filter(Boolean).slice(0, 10) };
  if (existsSync(resultFile)) r.run.result = JSON.parse(readFileSync(resultFile, 'utf8'));
  return r;
}

const out = { electronVite: require(join(nodeModules, 'electron-vite', 'package.json')).version, asar: require(join(nodeModules, '@electron/asar', 'package.json')).version, electron: require(join(nodeModules, 'electron', 'package.json')).version, playwrightCore: require(join(nodeModules, 'playwright-core', 'package.json')).version, startedAt: new Date().toISOString(), variants: [] };
for (const v of variants) {
  if (only.length && !only.includes(v.name)) continue;
  console.log(`[pack] --- ${v.name} ---`);
  try { out.variants.push(await runVariant(v)); } catch (e) { out.variants.push({ name: v.name, error: e.stack ?? String(e) }); }
  const last = out.variants[out.variants.length - 1];
  console.log(`[pack] ${v.name}: build ${last.build?.status} run ${last.run?.status} errors ${last.run?.result?.errors?.length ?? 'n/a'}`);
}
mkdirSync(resultsDir, { recursive: true });
writeFileSync(join(resultsDir, 'pack.json'), JSON.stringify(out, null, 2));
console.log('[pack] written');
