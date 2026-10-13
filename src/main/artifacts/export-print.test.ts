// The export service's cancellation races (M7 fix wave 2, the re-review's findings 1 and 3), with Electron's window and
// the file system's slow or failing steps faked: a cancellation while the printer prepares its page leaves no window,
// and a staged write that fails part-way leaves no temporary file.
import { mkdtemp as realMkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  windows: [] as { destroyed: boolean }[],
  mkdtempDelay: null as Promise<void> | null, // the printer's directory waits for it
  writeFails: null as ((path: string) => boolean) | null, // a write to such a path lands half, then fails
}));

vi.mock('electron', () => {
  let ids = 0;
  class FakeWindow {
    destroyed = false;
    private gone: (() => void) | null = null;
    // a print in progress until the window is destroyed (a real one prints for a while; the races need it alive)
    webContents = {
      id: ++ids,
      setWindowOpenHandler: () => {},
      on: () => {},
      printToPDF: () => new Promise<Buffer>((_, reject) => (this.gone = () => reject(new Error('the window was destroyed')))),
    };
    constructor() {
      fakes.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.gone?.();
    }
    async loadURL() {
      if (this.destroyed) throw new Error('the window was destroyed');
    }
  }
  return { BrowserWindow: FakeWindow };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    mkdtemp: async (prefix: string) => {
      const made = await real.mkdtemp(prefix);
      if (fakes.mkdtempDelay) await fakes.mkdtempDelay;
      return made;
    },
    writeFile: async (path: string, data: string | Uint8Array) => {
      if (fakes.writeFails?.(String(path))) {
        await real.writeFile(path, String(data).slice(0, 2)); // half of it on disk
        throw new Error('ENOSPC: no space left on device');
      }
      return real.writeFile(path, data);
    },
  };
});

import { ExporterRegistry, printHtmlToPdf, runExport, type ExportSources } from './export';

let root: string;
beforeEach(async () => {
  root = await realMkdtemp(join(tmpdir(), 'maws-export-race-'));
  fakes.windows.length = 0;
  fakes.mkdtempDelay = null;
  fakes.writeFails = null;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const printDirs = async () => (await readdir(tmpdir())).filter((name) => name.startsWith('maws-print-'));

describe('the PDF printer’s cancellation while it prepares its page', () => {
  it('makes no window when the export is cancelled while its directory is made, and leaves no directory', async () => {
    const before = await printDirs();
    let release!: () => void;
    fakes.mkdtempDelay = new Promise<void>((resolve) => (release = resolve));
    const cancel = new AbortController();
    const printing = printHtmlToPdf('<p>late window</p>', { signal: cancel.signal, blocked: () => {} });
    cancel.abort(); // the deadline, during the preparation's await
    release();
    await expect(printing).rejects.toThrow(/cancelled/);
    expect(fakes.windows).toEqual([]);
    expect(await printDirs()).toEqual(before);
  });

  it('through runExport: an export whose deadline falls while its printer prepares answers the timeout and leaves no window alive', async () => {
    let release!: () => void;
    fakes.mkdtempDelay = new Promise<void>((resolve) => (release = resolve));
    const registry = new ExporterRegistry();
    registry.register({ kind: 'document', format: 'pdf', run: async (req, ctx) => ctx.writeFile(req.path, await ctx.printToPdf('<p>late window</p>')) });
    const sources: ExportSources = { title: 'T', state: async () => new Uint8Array(), readAsset: async () => null, print: printHtmlToPdf };
    const answer = await runExport(registry, { artifactId: 'a', kind: 'document', format: 'pdf', revision: 1, path: join(root, '1-pdf.pdf') }, sources, 10);
    expect(answer).toEqual({ ok: false, error: 'the export did not finish within 0.01 s' });
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fakes.windows.every((win) => win.destroyed)).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });

  it('destroys at once a window whose cancellation came while it was being made ready', async () => {
    const cancel = new AbortController();
    fakes.writeFails = null;
    const printing = printHtmlToPdf('<p>x</p>', { signal: cancel.signal, blocked: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 10)); // past the preparation: the window exists
    cancel.abort();
    await printing.catch(() => {});
    expect(fakes.windows.every((win) => win.destroyed)).toBe(true);
  });
});

describe('a staged write that fails part-way', () => {
  it('leaves no temporary file, and the export answers the failure', async () => {
    fakes.writeFails = (path) => path.endsWith('.tmp');
    const registry = new ExporterRegistry();
    registry.register({ kind: 'document', format: 'pdf', run: async (req, ctx) => ctx.writeFile(req.path, 'whole export') });
    const sources: ExportSources = { title: 'T', state: async () => new Uint8Array(), readAsset: async () => null, print: async () => new Uint8Array() };
    const answer = await runExport(registry, { artifactId: 'a', kind: 'document', format: 'pdf', revision: 1, path: join(root, '1-pdf.pdf') }, sources, 1_000);
    expect(answer).toEqual({ ok: false, error: 'ENOSPC: no space left on device' });
    expect(await readdir(root)).toEqual([]);
  });
});
