// P3-F W-PKG (the tracker's packaged-SDK row): the resolution proof the packaged route-D scene runs in the packaged
// binary as Node (e2e/support/packaged-resolution.ts). Here the same script runs under this Node over a scratch app tree
// (a Resources directory holding `app.asar`'s layout as plain directories), so what it finds and what the problems
// checker refuses are pinned without an app: export maps that hide `package.json`, a dependency cycle, a package found
// only outside Resources (as a repository's node_modules above an app built inside it would be), a missing dependency,
// an optional peer, a pinned version, a missing chunk and the bound.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENGINE_HOST_MARKER, resolutionProblems, runResolution, type Resolution } from '../../e2e/support/packaged-resolution';

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

afterEach(() => rmSync(root, { recursive: true, force: true }));

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
