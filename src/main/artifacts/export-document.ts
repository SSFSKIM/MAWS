// The document kind's exporters for main's export service (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md,
// D12; §4.8 of the P3 spec; X25's `artifact_export`, X31): `document × {md, html, docx, pdf}`, each a pure function of
// the document's state at the request's revision (the live state or a retained version's) written to the path the
// service names. Markdown, HTML and DOCX are M6's converters; PDF is the standalone HTML export printed by the service's
// hidden capture window (`context.printToPdf`), the page's `@page` rule carrying the size and the margin, so one route
// serves `artifact_export` and the editor's Export menu alike. Registered with A's `ExporterRegistry` (A's M7) by
// `registerDocumentExporters` from main's start; `pageSize` comes on A's request (Letter by default, A4 selectable, the
// owner's Decision Log 43); the governing system's `DesignSystemExport` once D's apply API is on the base (the house
// system's look until then, exactly as the editor draws it without a scope).
import type { Actor } from '@shared/artifacts/actor';
import type { DesignSystemExport } from '@artifacts/document/export/design-system';
import { exportDocx } from '@artifacts/document/export/docx';
import { exportHtml } from '@artifacts/document/export/html';
import { exportMarkdown } from '@artifacts/document/export/markdown';
import { exportSource, type ImageLoader } from '@artifacts/document/export/source';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { Exporter, ExportContext, ExportRequest } from './export';

export const DOCUMENT_EXPORT_FORMATS = ['md', 'html', 'docx', 'pdf'] as const;
export type DocumentExportFormat = (typeof DOCUMENT_EXPORT_FORMATS)[number];

/** What the service asks for: A's export request (the format one of the four; `pageSize` Letter unless A4 or the system's tokens). */
export type DocumentExportRequest = ExportRequest;

/** What the service provides an exporter (A's context), and what this kind may be given beyond it. */
export interface DocumentExportContext extends ExportContext {
  /** The governing design system's export helpers (X28); the house system when absent. */
  system?: DesignSystemExport;
  /** A comment's author as Word names it; the session's title or "Claude", and "Owner", when absent. */
  authorName?(actor: Actor): string;
}

export interface DocumentExporter extends Exporter {
  kind: 'document';
  format: DocumentExportFormat;
  run(request: DocumentExportRequest, context: DocumentExportContext): Promise<void>;
}

// An image the export embeds: an asset through the service's reader; anything else (an https address) is not fetched
// by an export, so it prints as its alt text.
const imagesOf =
  (context: DocumentExportContext): ImageLoader =>
  async ({ src, assetId }) =>
    assetId ? context.readAsset(src) : null;

async function sourceOf(context: DocumentExportContext) {
  const doc = newDoc();
  try {
    applyV2(doc, await context.state());
    return exportSource(doc, context.title);
  } finally {
    doc.destroy();
  }
}

const html = async (request: DocumentExportRequest, context: DocumentExportContext): Promise<string> =>
  exportHtml(await sourceOf(context), { system: context.system, pageSize: request.pageSize, images: 'inline', loadImage: imagesOf(context) });

const RUN: Record<DocumentExportFormat, (request: DocumentExportRequest, context: DocumentExportContext) => Promise<void>> = {
  md: async (request, context) => context.writeFile(request.path, exportMarkdown(await sourceOf(context))),
  html: async (request, context) => context.writeFile(request.path, await html(request, context)),
  docx: async (request, context) =>
    context.writeFile(request.path, await exportDocx(await sourceOf(context), { system: context.system, pageSize: request.pageSize, loadImage: imagesOf(context), authorName: context.authorName })),
  pdf: async (request, context) => context.writeFile(request.path, await context.printToPdf(await html(request, context))),
};

export const DOCUMENT_EXPORTERS: readonly DocumentExporter[] = DOCUMENT_EXPORT_FORMATS.map((format) => ({ kind: 'document', format, run: RUN[format] }));

/** Registers the four document exporters through the service's `register` (A's registry); returns their removal. */
export function registerDocumentExporters(register: (exporter: DocumentExporter) => () => void): () => void {
  const offs = DOCUMENT_EXPORTERS.map((exporter) => register(exporter));
  return () => {
    for (const off of offs) off();
  };
}
