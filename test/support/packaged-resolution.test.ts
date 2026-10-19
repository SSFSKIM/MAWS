// P3-F W-PKG (the tracker's packaged-SDK row): the resolution proof the packaged route-D scene runs in the packaged
// binary as Node (e2e/support/packaged-resolution.ts). Here the same script runs under this Node over a scratch app tree
// (a Resources directory holding `app.asar`'s layout as plain directories), so what it finds and what the problems
// checker refuses are pinned without an app: export maps that hide `package.json`, a dependency cycle, a package found
// only outside Resources (as a repository's node_modules above an app built inside it would be), a missing dependency,
// an optional peer, a pinned version, a missing chunk and the bound.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGINE_HOST_MARKER, packagedResolution, resolutionProblems, runResolution, type Resolution } from '../../e2e/support/packaged-resolution';

let root: string;
let resources: string;
let app: string;

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function pkg(base: string, name: string, manifest: Record<string, unknown>, files: Record<string, string> = { 'index.js': 'module.exports = 1;' }): void {
  const dir = join(base, 'node_modules', name);
  writeJson(join(dir, 'package.json'), { name, version: '1.0.0', ...manifest });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
}

function chunk(requires: string[], marker = ENGINE_HOST_MARKER): void {
  mkdirSync(join(app, 'out', 'main'), { recursive: true });
  writeFileSync(join(app, 'out', 'main', 'index.js'), 'require("electron");\n');
  writeFileSync(join(app, 'out', 'main', 'host.js'), `${requires.map((name) => `const m${name.length} = require("${name}");`).join('\n')}\nthrow new Error("${marker}");\n`);
}

const run = (limit?: number): Resolution => runResolution(process.execPath, [], {}, { outMain: join(app, 'out', 'main'), marker: ENGINE_HOST_MARKER, ...(limit !== undefined && { limit }) });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-packaged-resolution-')));
  resources = join(root, 'MAWS.app', 'Contents', 'Resources');
  app = join(resources, 'app.asar');
  mkdirSync(app, { recursive: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('the packaged resolution script', () => {
  it('finds the host chunk, resolves its packages through their export maps and walks their production closure, cycle-safe', () => {
    // the SDK-like root exports subpaths only: `<name>/package.json` is not exported
    pkg(app, '@scope/sdk', { version: '1.32.1', exports: { './client/index.js': './dist/client.js' }, dependencies: { dep: '^1', zod: '^4' }, peerDependencies: { zod: '^4', optional: '^1' }, peerDependenciesMeta: { optional: { optional: true } } }, { 'dist/client.js': 'module.exports = 1;' });
    pkg(app, 'dep', { exports: { '.': { import: './index.mjs' } }, dependencies: { back: '^1' } }, { 'index.mjs': 'export default 1;' }); // ESM-only: no require condition
    pkg(app, 'back', { dependencies: { dep: '^1' } }); // a cycle back to dep
    pkg(app, 'zod', { version: '4.6.5' });
    chunk(['@scope/sdk/client/index.js', 'zod', 'node:fs', 'path']);

    const result = run();
    expect(result.error).toBeUndefined();
    expect(result.chunk).toBe(join(app, 'out', 'main', 'host.js'));
    expect(result.required).toEqual([
      { specifier: '@scope/sdk/client/index.js', file: join(app, 'node_modules', '@scope/sdk', 'dist', 'client.js') },
      { specifier: 'zod', file: join(app, 'node_modules', 'zod', 'index.js') },
    ]);
    expect(result.roots).toEqual([
      { name: '@scope/sdk', version: '1.32.1', dir: join(app, 'node_modules', '@scope/sdk') },
      { name: 'zod', version: '4.6.5', dir: join(app, 'node_modules', 'zod') },
    ]);
    expect(result.packages.map((entry) => entry.name).sort()).toEqual(['@scope/sdk', 'back', 'dep', 'zod']);
    expect(result.missing).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(resolutionProblems(result, resources, { '@scope/sdk': '1.32.1' })).toEqual([]);
  });

  it('reports a dependency installed nowhere, and one found only above Resources', () => {
    pkg(app, 'sdk', { dependencies: { absent: '^1', above: '^1' } });
    pkg(root, 'above', {}); // a node_modules above the app, as a repository's around a build made inside it
    chunk(['sdk']);

    const result = run();
    expect(result.missing).toEqual([{ from: 'sdk', name: 'absent' }]);
    expect(result.packages.find((entry) => entry.name === 'above')?.dir).toBe(join(root, 'node_modules', 'above'));
    expect(resolutionProblems(result, resources, {})).toEqual([
      'absent (a dependency of sdk) is not installed where the packaged app looks',
      `above resolves outside the app's Resources: ${join(root, 'node_modules', 'above')}`,
    ]);
  });

  it('reports a required specifier that does not resolve, and a root at another version than the pin', () => {
    pkg(app, 'sdk', { version: '1.31.0' });
    chunk(['sdk', 'gone/sub']);

    const result = run();
    expect(result.required).toEqual([
      { specifier: 'sdk', file: join(app, 'node_modules', 'sdk', 'index.js') },
      { specifier: 'gone/sub', file: null },
    ]);
    expect(resolutionProblems(result, resources, { sdk: '1.32.1', unused: '1.0.0' })).toEqual([
      'gone/sub, which the host chunk requires, does not resolve',
      'gone (required by the host chunk) is not installed where the packaged app looks',
      'sdk is 1.31.0 in the packaged app, not the pinned 1.32.1',
      'unused is pinned but the host chunk does not require it',
    ]);
  });

  it('reports no host chunk, and a closure past its bound', () => {
    chunk(['sdk'], 'another process');
    expect(resolutionProblems(run(), resources, {})).toEqual(['no chunk under out/main carries the engine host’s marker']);

    pkg(app, 'sdk', { dependencies: { a: '^1' } });
    pkg(app, 'a', { dependencies: { b: '^1' } });
    pkg(app, 'b', {});
    chunk(['sdk']);
    const bounded = run(2);
    expect(bounded.truncated).toBe(true);
    expect(resolutionProblems(bounded, resources, {})).toEqual(['the production closure passed its bound of 2 packages']);
  });

  it('reports a chunk outside the app and a script that failed', () => {
    const result: Resolution = { chunk: join(root, 'host.js'), required: [], roots: [], packages: [], missing: [], truncated: false, limit: 10 };
    expect(resolutionProblems(result, resources, {})).toEqual([`the host chunk lies outside the app's Resources: ${join(root, 'host.js')}`]);
    expect(resolutionProblems({ ...result, error: 'boom' }, resources, {})).toEqual(['the resolution script failed: boom']);
  });
});

describe('the packaged resolution probe’s environment', () => {
  // The packaged binary is stood in for by a shell wrapper at the packaged path (Contents/MacOS/MAWS) that records only
  // the controlled fields it was spawned with (never the whole environment: a runner's holds unrelated secrets), then
  // runs this Node over the same arguments: the check is at the spawn boundary. The scratch root, capture included, is
  // removed by afterEach.
  it('is the packaged supervisor’s: no NODE_OPTIONS, MAWS_HOST_MODE or MAWS_RELAY_URL reaches the child, Node mode and the scratch profile set', () => {
    pkg(app, 'sdk', {});
    chunk(['sdk']);
    const executable = join(resources, '..', 'MacOS', 'MAWS');
    const seen = join(root, "it's", 'child-env.txt'); // an apostrophe in the path, as a quoted shell word must survive
    mkdirSync(dirname(executable), { recursive: true });
    mkdirSync(dirname(seen), { recursive: true });
    const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`; // POSIX single-quoting
    const probe = [...['NODE_OPTIONS', 'MAWS_HOST_MODE', 'MAWS_RELAY_URL'].map((name) => `echo "${name}=\${${name}+set}"`), ...['ELECTRON_RUN_AS_NODE', 'MAWS_USER_DATA', 'CLAUDE_CONFIG_DIR'].map((name) => `echo "${name}=$${name}"`)];
    writeFileSync(executable, `#!/bin/sh\n{\n${probe.join('\n')}\n} > ${quoted(seen)}\nexec ${quoted(process.execPath)} "$@"\n`);
    chmodSync(executable, 0o755);
    for (const [name, value] of Object.entries({ NODE_OPTIONS: '--no-such-node-option', MAWS_HOST_MODE: 'detached', MAWS_RELAY_URL: 'http://127.0.0.1:1', CLAUDE_CONFIG_DIR: '/owner/.claude', ELECTRON_RUN_AS_NODE: '0' })) vi.stubEnv(name, value);

    const result = packagedResolution(executable, join(root, 'profile')); // an inherited bad Node option would stop the child before the script ran

    expect(result.error).toBeUndefined();
    expect(result.chunk).toBe(join(app, 'out', 'main', 'host.js'));
    const childEnv = Object.fromEntries(readFileSync(seen, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    expect(childEnv).toEqual({ NODE_OPTIONS: '', MAWS_HOST_MODE: '', MAWS_RELAY_URL: '', ELECTRON_RUN_AS_NODE: '1', MAWS_USER_DATA: join(root, 'profile'), CLAUDE_CONFIG_DIR: join(root, 'profile', 'claude-config') });
  });
});
