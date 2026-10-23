import { describe, expect, it, vi } from 'vitest';
import { createDocument } from '@artifacts/document/tabs';
import { schemaFor } from '@artifacts/document/schema';
import { newDoc, stateV2 } from '@artifacts/yjs';
import { DOCUMENT_EXPORTERS } from './export-document';
import type { ExportContext, ExportRequest } from './export';
import { documentPngExporter } from './inspection';

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
