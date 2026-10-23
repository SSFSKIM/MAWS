import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument } from '@artifacts/document/tabs';
import { schemaFor } from '@artifacts/document/schema';
import { newDoc, stateV2 } from '@artifacts/yjs';
import { DOCUMENT_EXPORTERS } from './export-document';
import type { ExportContext, ExportRequest } from './export';
import { documentPngExporter, renderDocumentViewport } from './inspection';

// Exercise the host-owned expressions against Chromium's scrolling contract without opening Electron.
const capture = vi.hoisted(() => ({ open: vi.fn(), settled: vi.fn(), load: vi.fn(), restrict: vi.fn() }));
vi.mock('./capture', async (original) => ({ ...await original<typeof import('./capture')>(), openCaptureWindow: capture.open, settled: capture.settled, loadSettled: capture.load }));
vi.mock('./policies', async (original) => ({ ...await original<typeof import('./policies')>(), restrictRequests: capture.restrict }));

describe('document viewport bounds', () => {
  let viewport: number;
  let content: number;
  let offset: number;
  let destroyed: boolean;
  const image = Buffer.from('viewport');
  beforeEach(() => {
    viewport = 480;
    content = 1200;
    offset = 0;
    destroyed = false;
    const element = { get scrollHeight() { return Math.max(viewport, content); }, get clientHeight() { return viewport; } };
    capture.open.mockImplementation((_width, height, _env, options?: { javascript?: boolean }) => {
      viewport = height;
      return {
        webContents: { id: 1, executeJavaScript: async (expression: string) => {
          // A disabled scripting world cannot serve the host's bounds/scroll reads (remote Electron regression).
          if (options?.javascript === false) throw new Error('Script failed to execute');
          return runInNewContext(expression, {
            document: { fonts: { ready: Promise.resolve() }, documentElement: element, scrollingElement: element },
            window: { scrollTo: (_x: number, y: number) => { offset = Math.min(y, Math.max(0, content - viewport)); } },
          });
        }, capturePage: async () => ({ toPNG: () => image }) },
        setContentSize: (_width: number, height: number) => { viewport = height; },
        isDestroyed: () => destroyed,
        destroy: () => { destroyed = true; },
      };
    });
    capture.restrict.mockReturnValue(() => {});
  });
  const request = (offsetY: number): ExportRequest => ({ artifactId: 'doc', kind: 'document', format: 'png', revision: 4, path: '/unused.png', width: 640, height: 480, offsetY });
  it('rejects an offset below scrollHeight that the viewport would silently clamp', async () => {
    await expect(renderDocumentViewport('<p>Document</p>', request(800), new AbortController().signal, {})).rejects.toThrow(/offsetY/);
    expect(offset).toBe(0);
    expect(destroyed).toBe(true);
  });
  it('accepts the last reachable offset without changing the requested viewport', async () => {
    expect(await renderDocumentViewport('<p>Document</p>', request(720), new AbortController().signal, {})).toEqual(image);
    expect(offset).toBe(720);
    expect(viewport).toBe(480);
  });
  it('accepts zero, but not a positive offset, for a document shorter than the viewport', async () => {
    content = 200;
    expect(await renderDocumentViewport('<p>Short</p>', request(0), new AbortController().signal, {})).toEqual(image);
    await expect(renderDocumentViewport('<p>Short</p>', request(1), new AbortController().signal, {})).rejects.toThrow(/offsetY/);
  });
});

// The converter is real: inspection must capture the same authored content as HTML export, not an empty or generic page.
describe('document visual inspection', () => {
  it('renders the authored document HTML into an image at the requested viewport and offset', async () => {
    const doc = newDoc();
    createDocument(doc, { title: 'Launch', body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship after review.' }] }] }) });
    const state = stateV2(doc);
    doc.destroy();
    const request: ExportRequest = { artifactId: 'doc', kind: 'document', format: 'png', revision: 4, path: '/output.png', width: 640, height: 480, offsetY: 320 };
    const image = Buffer.from('test image');
    const render = vi.fn(async () => image);
    const written = vi.fn(async () => {});
    const context: ExportContext = { title: 'Launch', state: async () => state, assets: { list: async () => [] }, readAsset: async () => null, printToPdf: async () => new Uint8Array(), writeFile: written, signal: new AbortController().signal };
    await documentPngExporter(DOCUMENT_EXPORTERS.find((exporter) => exporter.format === 'html')!, render).run(request, context);
    expect(render).toHaveBeenCalledWith(expect.stringContaining('Ship after review.'), request, context.signal);
    expect(render.mock.calls).toHaveLength(1);
    expect(written).toHaveBeenCalledWith('/output.png', image);
  });
});
