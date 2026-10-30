// scripts/latin1-bundles.ts: the main-process, host and preload bundles' re-print to Latin-1 text keeps every value the
// program computes, and the build fails where it cannot (a tagged template's raw text) or where the re-print was missed.
import { runInNewContext } from 'node:vm';
import type { Rollup } from 'vite';
import { describe, expect, it } from 'vitest';
import { latin1Bundles, toLatin1 } from '../scripts/latin1-bundles';

const ABOVE_LATIN1 = /[\u0100-\uffff]/;

// The program's value before and after the re-print, and the re-print itself
async function both(source: string): Promise<{ before: unknown; after: unknown; printed: string }> {
  const printed = await toLatin1(source);
  return { before: runInNewContext(source), after: runInNewContext(printed), printed };
}

describe('toLatin1', () => {
  it('returns a file already within Latin-1 as it is', async () => {
    const source = "const s = 'café'; /* naïve */ String.raw`é`;\n";
    expect(await toLatin1(source)).toBe(source);
  });

  it('escapes strings, untagged templates, identifiers and property names, and their values do not change', async () => {
    const { before, after, printed } = await both("const naïveπ = 1; const o = { '‘k’': 'a—b', π: `x — ${naïveπ} 😀`, naïveπ }; [naïveπ, o['‘k’'], o.π, Object.keys(o)]");
    expect(printed).not.toMatch(ABOVE_LATIN1);
    expect(after).toEqual(before);
  });

  it('writes a comment’s characters as \\u text, line and block comments alike, legal comments kept', async () => {
    // where esbuild keeps a comment: legal comments, class members, array elements
    const { before, after, printed } = await both('/*! licence — keep */\nclass C {\n  // ── the work ──\n  m() { return [\n    1,\n    // İ\n    2 /* → two */\n  ]; }\n}\nnew C().m();\n');
    expect(printed).not.toMatch(ABOVE_LATIN1);
    for (const comment of ['/*! licence \\u2014 keep */', '// \\u2500\\u2500 the work \\u2500\\u2500', '// \\u0130', '/* \\u2192 two */']) expect(printed).toContain(comment);
    expect(after).toEqual(before);
  });

  it('escapes a regular expression literal’s characters to the same matches, an identity escape and astral characters included', async () => {
    const samples = ['—', '——', 'x—y', '\\u2014', 'u2014', '×', '😀', '\ud83d', '’-', 'ᄀ', 'ᅟ', 'ᄑ', 'Ａ'];
    const literals = ['/[—-―]/', '/\\—/', '/[\\—]/', '/\\\\—/', '/😀/', '/[😀]/u', '/^[\\p{L}]+(?:[’-][\\p{L}]+)*$/u', '/[ᄀ-ᅟ＀-｠]/v', '/(?<名>—)\\k<名>/'];
    for (const literal of literals) {
      const source = `const re = ${literal}; JSON.stringify(${JSON.stringify(samples)}.map((s) => re.test(s)).concat(re.flags))`;
      const { before, after, printed } = await both(source);
      expect(printed, literal).not.toMatch(ABOVE_LATIN1);
      expect(after, literal).toBe(before);
    }
  });

  it('fails, naming the place, on a tagged template whose raw text holds a character above U+00FF, since an escape would change it', async () => {
    await expect(toLatin1('const a = 1;\nconst s = String.raw`a—b`;\n', 'host.js')).rejects.toThrow(/^host\.js:2:\d+: U\+2014 outside a comment or regular expression/);
    await expect(toLatin1('const tag = (s) => s.raw[0];\ntag`→`;\n')).rejects.toThrow(/U\+2192/);
  });

  it('leaves a tagged template’s raw Latin-1 text as it is while escaping the rest of the file', async () => {
    const { before, after, printed } = await both('const dash = "—"; [String.raw`é\\n${dash}`, dash]');
    expect(printed).not.toMatch(ABOVE_LATIN1);
    expect(printed).toContain('String.raw`é\\n${dash}`');
    expect(after).toEqual(before);
  });
});

// The plugin's hooks, called as Rollup calls them, with a context whose `error` throws as Rollup's does
const context = { error: (message: string) => { throw new Error(message); } } as unknown as Rollup.PluginContext;
const plugin = latin1Bundles();
const hook = <K extends 'renderStart' | 'renderChunk' | 'generateBundle'>(name: K) => plugin[name] as (...args: unknown[]) => unknown;
const chunk = (fileName: string, code: string) => ({ type: 'chunk', fileName, code }) as unknown as Rollup.OutputChunk;
const asset = (fileName: string, source: string | Uint8Array) => ({ type: 'asset', fileName, source }) as unknown as Rollup.OutputAsset;

describe('latin1Bundles', () => {
  it('re-prints a chunk as it renders', async () => {
    expect(await hook('renderChunk').call(context, "console.log('—');\n", chunk('index.js', ''))).toBe('console.log("\\u2014");\n');
  });

  it('fails the build on a chunk it cannot re-print', async () => {
    await expect(hook('renderChunk').call(context, 'String.raw`—`;\n', chunk('index.js', ''))).rejects.toThrow(/^index\.js:1:\d+: U\+2014/);
  });

  it('fails the build when an emitted .js file, chunk or host asset, still holds a character above U+00FF', () => {
    const generate = (bundle: Record<string, Rollup.OutputChunk | Rollup.OutputAsset>) => hook('generateBundle').call(context, {}, bundle);
    expect(() => generate({ 'index.js': chunk('index.js', "'é'"), 'index-host.js': asset('index-host.js', 'x\n\\u2014'), 'notes.txt': asset('notes.txt', '—') })).not.toThrow();
    expect(() => generate({ 'index-host.js': asset('index-host.js', 'x;\n// —') })).toThrow(/^index-host\.js:2:4: a character above U\+00FF survived/);
    expect(() => generate({ 'index-host.js': asset('index-host.js', new TextEncoder().encode('"→"')) })).toThrow(/^index-host\.js:1:2: /);
    expect(() => generate({ 'chunks/a.js': chunk('chunks/a.js', '"→"') })).toThrow(/^chunks\/a\.js:1:2: /);
  });

  it('refuses a build with source maps, which the re-print does not chain', () => {
    expect(() => hook('renderStart').call(context, { sourcemap: true })).toThrow(/source maps/);
    expect(() => hook('renderStart').call(context, { sourcemap: false })).not.toThrow();
  });
});
