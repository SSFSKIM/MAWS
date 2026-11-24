// The bundle's table (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §M; T13): static files are
// served from a table made once, never from a path a requester wrote.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBundle } from './static';

const FIXTURE = resolve(__dirname, '../../../test/fixtures/sheet-page/bundle');
let scratch: string;

beforeEach(() => void (scratch = mkdtempSync(join(tmpdir(), 'maws-sheet-static-'))));
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe('readBundle', () => {
  it('lists every regular file of a listed extension by URL path, the shell first', async () => {
    const table = await readBundle(FIXTURE);
    expect(table.shell.type).toBe('text/html; charset=utf-8');
    expect((await table.shell.read()).toString('utf8')).toContain('<div id="root">');
    expect(table.get('/assets/page.js')).toMatchObject({ type: 'text/javascript; charset=utf-8' });
    expect(table.get('/assets/page.css')).toMatchObject({ type: 'text/css; charset=utf-8' });
    expect(table.get('/index.html')).toBe(table.shell);
    expect(table.shell.etag).toMatch(/^"[0-9a-f]+"$/);
  });

  it('is a lookup: no path a requester writes is joined to the directory', async () => {
    const bundle = join(scratch, 'bundle');
    mkdirSync(join(bundle, 'assets'), { recursive: true });
    writeFileSync(join(bundle, 'index.html'), '<!doctype html>');
    writeFileSync(join(scratch, 'secret.js'), 'secret');
    const table = await readBundle(bundle);
    for (const path of ['/../secret.js', '/assets/../../secret.js', '/assets%2F..%2F..%2Fsecret.js', '/%2e%2e/secret.js', '//secret.js', '/assets/', '/assets', '']) expect(table.get(path), path).toBeNull();
  });

  it('follows no link and lists no file of an unlisted extension', async () => {
    const bundle = join(scratch, 'bundle');
    mkdirSync(join(bundle, 'assets'), { recursive: true });
    mkdirSync(join(scratch, 'outside'));
    writeFileSync(join(bundle, 'index.html'), '<!doctype html>');
    writeFileSync(join(scratch, 'outside', 'secret.js'), 'secret');
    writeFileSync(join(bundle, 'notes.txt'), 'not listed');
    writeFileSync(join(bundle, 'source.map'), 'not listed');
    symlinkSync(join(scratch, 'outside', 'secret.js'), join(bundle, 'assets', 'linked.js'));
    symlinkSync(join(scratch, 'outside'), join(bundle, 'linked-dir'));
    const table = await readBundle(bundle);
    for (const path of ['/assets/linked.js', '/linked-dir/secret.js', '/notes.txt', '/source.map']) expect(table.get(path), path).toBeNull();
  });

  it('refuses a directory with no index.html', async () => {
    await expect(readBundle(scratch)).rejects.toThrow(/index\.html/);
  });
});
