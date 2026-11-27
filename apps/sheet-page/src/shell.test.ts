// The built shell (§P; §8.2's rule 3): the page server's content policy allows no inline script, so the built
// index.html names its script and its stylesheet as files and holds no script of its own, and no handler in an
// attribute. Built here, into a scratch directory, with the page's own Vite config, so the unit job checks the bundle
// that ships whether or not a build is lying around.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const out = mkdtempSync(join(tmpdir(), 'sheet-page-shell-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));
beforeAll(async () => {
  await build({ configFile: resolve(import.meta.dirname, '../vite.config.ts'), root: resolve(import.meta.dirname, '..'), logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
}, 120_000);

describe('the built shell', () => {
  it('names its script and its stylesheet as files of the bundle, and holds no inline script', () => {
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes, body] of scripts) {
      expect(body!.trim(), 'an inline script').toBe('');
      expect(attributes).toMatch(/\bsrc="\/assets\/[^"]+\.js"/);
    }
    expect(html).toMatch(/<link rel="stylesheet"[^>]* href="\/assets\/[^"]+\.css"/);
    expect(html).not.toMatch(/\son[a-z]+=/i); // no handler in an attribute
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\//); // nothing from another origin
  });

  it('is a bundle of the page server’s table: every file of a listed type, no source map, no service worker', () => {
    const files = readdirSync(out, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
    expect(files).toContain('index.html');
    for (const name of files) expect(name, name).toMatch(/\.(html|js|css|woff2|woff|ttf|png|ico|svg|json)$/);
    expect(files.some((name) => /^(sw|service-worker)([-.][A-Za-z0-9_]+)?\.js$/.test(name))).toBe(false); // not mermaid's `swimlanes-…` chunk
    const scripts = readdirSync(out, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.js'));
    for (const entry of scripts) expect(readFileSync(join(entry.parentPath, entry.name), 'utf8'), entry.name).not.toContain('serviceWorker.register');
  });

  it('asks for every lazy chunk through the chunk gate, and preloads none past it (T28)', () => {
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    expect(html).not.toContain('modulepreload');
    const scripts = readdirSync(out, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.js'));
    const code = scripts.map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'));
    const gated = code.flatMap((text) => [...text.matchAll(/__sheetChunk\(import\.meta\.url,"\.\/[^"]+\.js"\)/g)]);
    expect(gated.length).toBeGreaterThan(100); // the grammars, the themes, the diagram renderer and its kinds
    // no chunk is imported as the browser's own, and the one import of a computed URL is the gate's, of the URL it
    // was handed (a grammar's `import(?=…` is a pattern in a string, not a call)
    const chunkImports = code.flatMap((text) => [...text.matchAll(/(?<![\w$.])import\((["'`])\.{1,2}\/[^"'`]+\.js\1\)/g)]);
    expect(chunkImports.map((match) => match[0])).toEqual([]);
    const computed = code.flatMap((text) => [...text.matchAll(/(?<![\w$.])import\([A-Za-z_$][\w$]*\)/g)]);
    expect(computed).toHaveLength(1);
    // Vite's preload helper is handed no list of dependencies to fetch ahead of a gated chunk
    expect(code.filter((text) => text.includes('__vite__mapDeps'))).toHaveLength(0);
  });
});
