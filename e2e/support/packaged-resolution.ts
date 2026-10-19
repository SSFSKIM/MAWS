// P3-F W-PKG (the tracker's packaged-SDK row; P3 Decision Log 101, P3-HD's E10 ruling): what the packaged app's own
// binary, run as Node as its detached supervisor is (ELECTRON_RUN_AS_NODE=1), resolves for the engine host's chunk. The
// SDK is an external production dependency required at the chunk's top level, so the route-D scene passing in the
// packaged app shows that the host loaded it; this shows where from. The packaged app is built inside the repository,
// whose own node_modules holds the same closure, so a package missing from the app could still be found above it unless
// the binary's search paths stay inside the bundle (Electron's Node-mode init keeps them under `process.resourcesPath`).
// The script finds the chunk by the host's own refusal text (as src/engine-host/bundle-guard.test.ts does), resolves
// every non-builtin it requires from there, then walks the production closure of those packages: each `dependencies`
// entry and each non-optional peer, located as Node locates a package directory (the lookup paths the binary's module
// system gives, which an export map does not change: `<name>/package.json` need not be exported), never by loading one.
// Cycle-safe (one visit per directory) and bounded. test/support/packaged-resolution.test.ts runs the same script under
// Node over a scratch tree.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { launchEnvironment } from './scratch-env';

export const ENGINE_HOST_MARKER = 'the engine host needs MAWS_USER_DATA'; // src/engine-host/index.ts's refusal
const DEFAULT_LIMIT = 5_000; // packages; far above any closure the host has

export interface ResolutionInput {
  outMain: string; // the app's out/main (inside app.asar when packaged)
  marker: string;
  limit?: number;
}

export interface ResolvedPackage {
  name: string;
  version: string;
  dir: string;
}

export interface Resolution {
  error?: string; // the script itself failed
  chunk: string | null; // the engine host's chunk, null when none carries the marker
  required: { specifier: string; file: string | null }[]; // each non-builtin the chunk requires, as the binary resolves it
  roots: ResolvedPackage[]; // the packages those specifiers name
  packages: ResolvedPackage[]; // the production closure, roots included
  missing: { from: string | null; name: string }[]; // a package found nowhere the binary looks (`from` null: the chunk)
  truncated: boolean;
  limit: number;
}

// Plain CommonJS for the binary's `-e`; its input is MAWS_RESOLUTION_INPUT, its answer one JSON line on stdout.
export const RESOLUTION_SCRIPT = String.raw`
const fs = require('fs');
const path = require('path');
const { builtinModules, createRequire } = require('module');
const input = JSON.parse(process.env.MAWS_RESOLUTION_INPUT);
const limit = input.limit || ${DEFAULT_LIMIT};
const out = { chunk: null, required: [], roots: [], packages: [], missing: [], truncated: false, limit };
try {
  const files = fs.readdirSync(input.outMain).filter((file) => file.endsWith('.js')).sort().map((file) => path.join(input.outMain, file));
  out.chunk = files.find((file) => fs.readFileSync(file, 'utf8').includes(input.marker)) || null;
  if (out.chunk !== null) {
    const text = fs.readFileSync(out.chunk, 'utf8');
    const builtin = (name) => name.startsWith('node:') || builtinModules.includes(name) || name === 'electron';
    const specifiers = [...new Set([...text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]))].filter((name) => !builtin(name) && !name.startsWith('.'));
    const fromChunk = createRequire(out.chunk);
    const packageName = (specifier) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
    const locate = (fromFile, name) => {
      for (const base of createRequire(fromFile).resolve.paths(name) || []) {
        const manifest = path.join(base, name, 'package.json');
        if (fs.existsSync(manifest)) return path.join(base, name);
      }
      return null;
    };
    const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const specifier of specifiers) {
      let file = null;
      try { file = fromChunk.resolve(specifier); } catch {}
      out.required.push({ specifier, file });
    }
    const seen = new Set();
    const queue = [];
    const visit = (dir, from, name) => {
      if (dir === null) { out.missing.push({ from, name }); return null; }
      const key = (() => { try { return fs.realpathSync(dir); } catch { return dir; } })();
      if (seen.has(key)) return null;
      if (seen.size >= limit) { out.truncated = true; return null; }
      seen.add(key);
      const manifest = read(dir);
      const entry = { name, version: String(manifest.version), dir };
      out.packages.push(entry);
      queue.push({ dir, manifest });
      return entry;
    };
    for (const name of [...new Set(specifiers.map(packageName))]) {
      const dir = locate(out.chunk, name);
      const entry = visit(dir, null, name);
      if (entry !== null) out.roots.push(entry);
    }
    while (queue.length > 0 && !out.truncated) {
      const { dir, manifest } = queue.shift();
      const optional = manifest.peerDependenciesMeta || {};
      const peers = Object.keys(manifest.peerDependencies || {}).filter((name) => !(optional[name] && optional[name].optional));
      const from = String(manifest.name);
      for (const name of [...new Set([...Object.keys(manifest.dependencies || {}), ...peers])]) visit(locate(path.join(dir, 'package.json'), name), from, name);
    }
  }
} catch (error) {
  out.error = error && error.stack ? String(error.stack) : String(error);
}
process.stdout.write(JSON.stringify(out) + '\n');
`;

// Runs the script with `command` (the packaged binary, or Node under the unit test) over `env`.
export function runResolution(command: string, args: string[], env: Record<string, string>, input: ResolutionInput): Resolution {
  const stdout = execFileSync(command, [...args, '-e', RESOLUTION_SCRIPT], { env: { ...env, MAWS_RESOLUTION_INPUT: JSON.stringify(input) }, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  const line = stdout.trim().split('\n').at(-1) ?? '';
  return JSON.parse(line) as Resolution;
}

// The bundle's Resources directory for a packaged executable (…/MAWS.app/Contents/MacOS/MAWS).
export const resourcesOf = (executable: string) => resolve(dirname(executable), '..', 'Resources');

// The packaged binary as its supervisor runs (ELECTRON_RUN_AS_NODE=1), with the e2e launch's environment (every inherited
// CLAUDE* variable dropped; no engine is started, no model or network is used) over the scene's scratch profile, then
// the scrub main's supervisorEnv (src/main/hosts/detached-transport.ts) makes for a packaged app: no NODE_OPTIONS (a
// preload, loader or inspector flag the actual supervisor never receives), no MAWS_HOST_MODE, no dev relay override.
// Written out here, not imported: that module is main's, and the e2e project compiles only the files it names.
export function packagedResolution(executable: string, userData: string): Resolution {
  const env: Record<string, string> = { ...launchEnvironment(process.env, userData), ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_OPTIONS;
  delete env.MAWS_HOST_MODE;
  delete env.MAWS_RELAY_URL;
  return runResolution(executable, [], env, { outMain: join(resourcesOf(executable), 'app.asar', 'out', 'main'), marker: ENGINE_HOST_MARKER });
}

// The repository's exact production pin of `name` (package.json `dependencies`).
export function productionPin(repoRoot: string, name: string): string {
  const pin = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }).dependencies?.[name];
  if (pin === undefined || !/^\d+\.\d+\.\d+$/.test(pin)) throw new Error(`package.json pins no exact production version of ${name} (${pin ?? 'absent'})`);
  return pin;
}

// What the resolution shows wrong for an app whose Resources directory is `resources`, with `pins` the exact versions
// the roots must have; empty when the host's chunk and every package of its closure resolve inside the app.
export function resolutionProblems(result: Resolution, resources: string, pins: Record<string, string>): string[] {
  if (result.error !== undefined) return [`the resolution script failed: ${result.error}`];
  if (result.chunk === null) return ['no chunk under out/main carries the engine host’s marker'];
  const inside = (path: string) => path.startsWith(`${resources}${sep}`);
  const problems: string[] = [];
  if (!inside(result.chunk)) problems.push(`the host chunk lies outside the app's Resources: ${result.chunk}`);
  for (const { specifier, file } of result.required) {
    if (file === null) problems.push(`${specifier}, which the host chunk requires, does not resolve`);
    else if (!inside(file)) problems.push(`${specifier} resolves outside the app's Resources: ${file}`);
  }
  for (const { from, name } of result.missing) problems.push(`${name} (${from === null ? 'required by the host chunk' : `a dependency of ${from}`}) is not installed where the packaged app looks`);
  for (const { name, dir } of result.packages) if (!inside(dir)) problems.push(`${name} resolves outside the app's Resources: ${dir}`);
  if (result.truncated) problems.push(`the production closure passed its bound of ${result.limit} packages`);
  for (const [name, pin] of Object.entries(pins)) {
    const root = result.roots.find((entry) => entry.name === name);
    if (root === undefined) problems.push(`${name} is pinned but the host chunk does not require it`);
    else if (root.version !== pin) problems.push(`${name} is ${root.version} in the packaged app, not the pinned ${pin}`);
  }
  return problems;
}
