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
    expect(files.some((name) => /^(sw|service-worker)/.test(name))).toBe(false);
  });
});
