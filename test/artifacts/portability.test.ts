// The portability rule of src/artifacts/ (§4.10 of docs/doperpowers/plans/2026-10-12-p3-co-work.md; the P3-A document's
// M1) and the binding-module rule (Decision Log 25: Yjs only through src/artifacts/yjs/), proven by linting scratch
// sources at paths the repository's eslint.config.js governs.
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

async function rulesFired(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, file) });
  return result.messages.map((message) => message.ruleId ?? message.message);
}

const PORTABLE = 'src/artifacts/provider/__lint_fixture__.ts';
const FORBIDDEN_MODULES = [
  'electron',
  'node:fs',
  'node:worker_threads',
  'node:sqlite',
  'fs',
  'fs/promises',
  'path',
  'os',
  'child_process',
  'net',
  'worker_threads',
  'crypto',
  'stream',
  'buffer',
  'url',
  'util',
  'events',
];

describe('the portability rule (src/artifacts/)', () => {
  it.each(FORBIDDEN_MODULES)('refuses an import of %s, in every import form', async (name) => {
    expect(await rulesFired(`import x from '${name}';\nexport default x;\n`, PORTABLE)).toEqual(['no-restricted-imports']);
    expect(await rulesFired(`import type { X } from '${name}';\nexport type Y = X;\n`, PORTABLE)).toEqual(['no-restricted-imports']);
    expect(await rulesFired(`export * from '${name}';\n`, PORTABLE)).toEqual(['no-restricted-imports']);
    expect(await rulesFired(`export const load = () => import('${name}');\n`, PORTABLE)).toEqual(['no-restricted-syntax']);
  });

  it('refuses window.maws however it is reached, and the Node globals', async () => {
    expect(await rulesFired('export const ipc = window.maws;\n', PORTABLE)).toEqual(['no-restricted-properties']);
    expect(await rulesFired("export const ipc = window['maws'];\n", PORTABLE)).toEqual(['no-restricted-properties']);
    expect(await rulesFired('const { maws } = window;\nexport { maws };\n', PORTABLE)).toEqual(['no-restricted-properties']);
    expect(await rulesFired('export const ipc = globalThis.maws;\n', PORTABLE)).toEqual(['no-restricted-properties']);
    expect(await rulesFired('export const home = process.env.HOME;\n', PORTABLE)).toEqual(['no-restricted-globals']);
    expect(await rulesFired('export const bytes = Buffer.from([1]);\n', PORTABLE)).toEqual(['no-restricted-globals']);
  });

  it('lets portable code through: zod, the binding module, @y/protocols, a lazy import of a package, DOM globals', async () => {
    const code = [
      "import * as z from 'zod';",
      "import { Awareness } from '@y/protocols/awareness';",
      "import { newDoc } from '../yjs';",
      "export const load = () => import('katex');",
      'export const channel = new MessageChannel();',
      'export const parts = [z, Awareness, newDoc];',
      '',
    ].join('\n');
    expect(await rulesFired(code, PORTABLE)).toEqual([]);
  });

  it('applies only under src/artifacts/', async () => {
    expect(await rulesFired("import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n", 'src/engine-host/__lint_fixture__.ts')).toEqual([]);
  });
});

describe('the binding-module rule (Yjs only through src/artifacts/yjs/)', () => {
  const yjs = "import * as Y from '@y/y';\nimport { syncPlugin } from '@y/prosemirror';\nexport const parts = [Y, syncPlugin];\n";

  it('lets src/artifacts/yjs/ import @y/y and @y/prosemirror', async () => {
    expect(await rulesFired(yjs, 'src/artifacts/yjs/__lint_fixture__.ts')).toEqual([]);
  });

  it.each(['src/artifacts/provider/__lint_fixture__.ts', 'src/engine-host/documents/__lint_fixture__.ts', 'src/renderer/src/__lint_fixture__.tsx'])(
    'refuses them in %s',
    async (file) => {
      expect(await rulesFired(yjs, file)).toEqual(['no-restricted-imports', 'no-restricted-imports']);
    },
  );

  const lazy = "export const load = () => [import('@y/y'), import('@y/prosemirror'), import('@y/y/meta')];\n";

  it.each([
    'src/artifacts/provider/__lint_fixture__.ts',
    'src/engine-host/documents/__lint_fixture__.ts',
    'src/renderer/src/__lint_fixture__.tsx',
    'src/main/browser/import/__lint_fixture__.ts',
    'src/main/browser/import/log.ts',
  ])('refuses a dynamic import of them in %s', async (file) => {
    expect(await rulesFired(lazy, file)).toEqual(['no-restricted-syntax', 'no-restricted-syntax', 'no-restricted-syntax']);
  });

  it('lets src/artifacts/yjs/ import them lazily, and a lazy @y/protocols anywhere', async () => {
    expect(await rulesFired(lazy, 'src/artifacts/yjs/__lint_fixture__.ts')).toEqual([]);
    expect(await rulesFired("export const load = () => import('@y/protocols/awareness');\n", 'src/renderer/src/__lint_fixture__.tsx')).toEqual([]);
  });

  it('keeps the other no-restricted-syntax rules of the files it shares (the renderer’s postfix rule, the import log rule)', async () => {
    expect(await rulesFired('export const bump = (counter: { n: number }) => counter.n++;\n', 'src/renderer/src/__lint_fixture__.tsx')).toEqual(['no-restricted-syntax']);
    expect(await rulesFired("console.log('x');\n", 'src/main/browser/import/__lint_fixture__.ts')).toEqual(['no-restricted-syntax']);
  });

  it('still refuses Node in src/artifacts/yjs/', async () => {
    expect(await rulesFired("import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n", 'src/artifacts/yjs/__lint_fixture__.ts')).toEqual(['no-restricted-imports']);
  });
});
