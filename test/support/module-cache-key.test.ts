// The module cache's resolution key (test/support/module-cache-key.ts): what a module's key adds for the paths it names
// changes exactly when a file that could decide one of them appears or vanishes, a module whose transform expands a glob
// is not cached at all, and every project of vitest.config.ts carries the plugin that adds it.
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import config from '../../vitest.config';
import { resolutionKey } from './module-cache-key';

let root: string;
const file = (path: string, text = '') => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
};
const key = (path: string, source: string, aliases = [{ find: '@lib', replacement: join(root, 'lib') }]) => resolutionKey(join(root, path), source, aliases);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'module-cache-key-'));
  file('src/x.ts');
  file('src/y.ts');
  file('src/a.ts');
  file('src/dir/index.ts');
  file('lib/util.ts');
  file('src/locales/en.json');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('a module’s resolution key', () => {
  it('changes when the file an import found is renamed, or another now wins its resolution', () => {
    const source = "import { x } from './x';";
    const before = key('src/a.ts', source);
    renameSync(join(root, 'src/x.ts'), join(root, 'src/x.tsx'));
    const renamed = key('src/a.ts', source);
    expect(renamed).not.toBe(before);
    file('src/x.mjs');
    expect(key('src/a.ts', source)).not.toBe(renamed);
  });

  it('holds when a file of another name is added beside it, or the import’s own content changes', () => {
    const source = "import { x } from './x';\nexport const y = import('../src/y.ts?raw');";
    const before = key('src/a.ts', source);
    file('src/z.ts');
    file('src/x.ts', 'export const x = 2;');
    expect(key('src/a.ts', source)).toBe(before);
  });

  it('follows a directory import into its index files', () => {
    const source = "export * from './dir';";
    const before = key('src/a.ts', source);
    file('src/dir/other.ts');
    expect(key('src/a.ts', source)).toBe(before);
    file('src/dir/index.tsx');
    expect(key('src/a.ts', source)).not.toBe(before);
  });

  it('resolves an alias', () => {
    const source = "import { util } from '@lib/util';";
    const before = key('src/a.ts', source);
    file('lib/util.mts');
    expect(key('src/a.ts', source)).not.toBe(before);
  });

  it('is false, so the module is never cached, wherever vite’s transform expands a glob', () => {
    expect(key('src/a.ts', "const files = import.meta.glob<string>('./locales/*.json', { eager: true });")).toBe(false);
    expect(key('src/a.ts', "const files = import.meta.glob('./locales/*.json');")).toBe(false);
    expect(key('src/a.ts', 'const load = (lang) => import(`./locales/${lang}.json`);')).toBe(false);
    expect(key('src/a.ts', 'const url = (name) => new URL(`./locales/${name}.json`, import.meta.url);')).toBe(false);
    expect(key('src/a.ts', 'const load = () => import(`./locales/en.json`);')).not.toBe(false);
  });

  it('adds nothing for bare package imports, which the lockfile keys', () => {
    expect(key('src/a.ts', "import React from 'react';\nimport { v } from 'vitest';")).toBe('');
  });
});

it('every project of vitest.config.ts carries the plugin that adds it', () => {
  const projects = (config.test?.projects ?? []).filter((p) => typeof p === 'object') as unknown as { test?: { name?: string }; plugins?: unknown[] }[];
  expect(projects.length).toBeGreaterThan(5);
  for (const project of projects) {
    expect(project.plugins?.flat(Infinity).map((p) => (p as { name?: string }).name), project.test?.name).toContain('maws:module-cache-key');
  }
});
