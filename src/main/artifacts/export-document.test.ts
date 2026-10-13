// The document exporters for main's export service (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D12):
// each format written from the state the service hands it, the PDF printed from the standalone HTML whose `@page` rule
// carries Letter by default and A4 when chosen, the margin from the page tokens; assets read through the service.
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { exportMarkdown } from '@artifacts/document/export/markdown';
import { exportSource } from '@artifacts/document/export/source';
import { schemaFor } from '@artifacts/document/schema';
import { addTab, createDocument } from '@artifacts/document/tabs';
import { newDoc, stateV2 } from '@artifacts/yjs';
import { ExporterRegistry } from './export';
import { DOCUMENT_EXPORTERS, registerDocumentExporters, type DocumentExportContext, type DocumentExportFormat, type DocumentExportRequest } from './export-document';

const schema = schemaFor();
const PDF = new TextEncoder().encode('%PDF-1.4 stand-in');

function documentState(): Uint8Array {
  const doc = newDoc();
  const first = createDocument(doc, {
    title: 'Overview',
    body: schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: 'h1aaaaaa', level: 1 }, content: [{ type: 'text', text: 'Launch plan' }] },
        { type: 'paragraph', attrs: { id: 'p1aaaaaa' }, content: [{ type: 'text', text: 'The launch waits for the review.' }] },
        { type: 'paragraph', attrs: { id: 'p2aaaaaa' }, content: [{ type: 'image', attrs: { src: 'assets/chart.png', alt: 'The chart', assetId: '7f9c2ba4-e88f-4a1c-b0a2-1f0e2d3c4b5a' } }] },
        { type: 'paragraph', attrs: { id: 'p3aaaaaa' }, content: [{ type: 'image', attrs: { src: 'https://example.com/a.png', alt: 'Remote', assetId: null } }] },
      ],
    }),
  });
  addTab(doc, { title: 'Notes', body: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'n1aaaaaa' }, content: [{ type: 'text', text: '안녕하세요, 팀 여러분.' }] }] }), after: first });
  const state = stateV2(doc);
  doc.destroy();
  return state;
}

// A one-pixel PNG, the asset the service reads.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function context(state = documentState()) {
  const written = new Map<string, Uint8Array | string>();
  const printed: string[] = [];
  const ctx: DocumentExportContext = {
    title: 'Launch plan',
    state: vi.fn(async () => state),
    readAsset: vi.fn(async (ref: string) => (ref === 'assets/chart.png' ? { bytes: PNG, mime: 'image/png' } : null)),
    printToPdf: vi.fn(async (html: string) => (printed.push(html), PDF)),
    writeFile: vi.fn(async (path: string, data: Uint8Array | string) => void written.set(path, data)),
    signal: new AbortController().signal,
  };
  return { ctx, written, printed };
}

const exporter = (format: DocumentExportFormat) => DOCUMENT_EXPORTERS.find((e) => e.format === format)!;
const request = (format: DocumentExportFormat, extra: Partial<DocumentExportRequest> = {}): DocumentExportRequest => ({ artifactId: 'a1', kind: 'document', format, revision: 7, path: `/exports/7-${format}`, ...extra });

describe('the document exporters', () => {
  it('are registered for document × {md, html, docx, pdf} through one call, and removed by its answer', () => {
    const removed: string[] = [];
    const registered: string[] = [];
    const off = registerDocumentExporters((e) => {
      registered.push(`${e.kind}:${e.format}`);
      return () => removed.push(e.format);
    });
    expect(registered).toEqual(['document:md', 'document:html', 'document:docx', 'document:pdf']);
    off();
    expect(removed).toEqual(['md', 'html', 'docx', 'pdf']);
  });

  it('register into A’s export registry, the service’s lookup finding each format', () => {
    const registry = new ExporterRegistry();
    const off = registerDocumentExporters((e) => registry.register(e));
    expect(['md', 'html', 'docx', 'pdf'].map((format) => registry.get('document', format as DocumentExportFormat)?.format)).toEqual(['md', 'html', 'docx', 'pdf']);
    expect(registry.get('document', 'png')).toBeUndefined();
    off();
    expect(registry.get('document', 'pdf')).toBeUndefined();
  });

  it('writes Markdown from the state the service hands it, every tab under its title', async () => {
    const state = documentState();
    const { ctx, written } = context(state);
    await exporter('md').run(request('md'), ctx);
    const doc = newDoc();
    const { applyV2 } = await import('@artifacts/yjs');
    applyV2(doc, state);
    expect(written.get('/exports/7-md')).toBe(exportMarkdown(exportSource(doc, 'Launch plan')));
    expect(written.get('/exports/7-md')).toContain('# Notes');
  });

  it('writes the standalone HTML with the asset inlined, the remote image not fetched, Letter by default', async () => {
    const { ctx, written } = context();
    await exporter('html').run(request('html'), ctx);
    const html = written.get('/exports/7-html') as string;
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('The launch waits for the review.');
    expect(html).toContain('data:image/png;base64,');
    expect(ctx.readAsset).toHaveBeenCalledWith('assets/chart.png');
    expect(ctx.readAsset).toHaveBeenCalledTimes(1);
    expect(html).toMatch(/@page \{ size: 8\.5in 11in; margin: [^;]+; \}/);
  });

  it('prints the PDF from that page through the capture window, A4 when chosen, and writes what it printed', async () => {
    const { ctx, written, printed } = context();
    await exporter('pdf').run(request('pdf'), ctx);
    expect(printed).toHaveLength(1);
    expect(printed[0]).toMatch(/@page \{ size: 8\.5in 11in;/);
    expect(printed[0]).toContain('<section class="doc-tab"'); // a tab per printed page (break-before: page)
    expect(written.get('/exports/7-pdf')).toBe(PDF);
    const a4 = context();
    await exporter('pdf').run(request('pdf', { pageSize: 'a4' }), a4.ctx);
    expect(a4.printed[0]).toMatch(/@page \{ size: 210mm 297mm;/);
  });

  it('writes the DOCX on Letter by default and A4 when chosen, the picture embedded', async () => {
    const pageWidth = async (pageSize?: 'letter' | 'a4') => {
      const { ctx, written } = context();
      await exporter('docx').run(request('docx', pageSize ? { pageSize } : {}), ctx);
      const zip = await JSZip.loadAsync(written.get('/exports/7-docx') as Uint8Array);
      const xml = await zip.file('word/document.xml')!.async('string');
      expect(xml).toContain('안녕하세요, 팀 여러분.');
      expect(Object.keys(zip.files).some((name) => name.startsWith('word/media/'))).toBe(true);
      return /<w:pgSz w:w="(\d+)"/.exec(xml)?.[1];
    };
    expect(await pageWidth()).toBe('12240');
    expect(await pageWidth('a4')).toBe('11906');
  });

  it('fails the export when the service cannot hand the state or the asset reader fails', async () => {
    const broken = context();
    broken.ctx.state = async () => Promise.reject(new Error('the host is gone'));
    await expect(exporter('md').run(request('md'), broken.ctx)).rejects.toThrow('the host is gone');
    const reader = context();
    reader.ctx.readAsset = async () => Promise.reject(new Error('the asset is unreadable'));
    await expect(exporter('pdf').run(request('pdf'), reader.ctx)).rejects.toThrow('the asset is unreadable');
    expect(reader.written.size).toBe(0);
  });
});
