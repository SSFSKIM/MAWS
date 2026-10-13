// The document kind's exporters for main's export service (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md,
// D12; §4.8 of the P3 spec; X25's `artifact_export`, X31): `document × {md, html, docx, pdf}`, each a pure function of
// the document's state at the request's revision (the live state or a retained version's) written to the path the
// service names. Markdown, HTML and DOCX are M6's converters; PDF is the standalone HTML export printed by the service's
// hidden capture window (`printToPdf`, export-pdf.ts), the page's `@page` rule carrying the size and the margin, so one
// route serves `artifact_export` and the editor's Export menu alike.
//
// A's export service (its M7: the registry, `ArtifactExportRequest`, the capture window on `maws-capture`) is not on
// this branch's base, so this module states the shape it registers into and is wired by one call,
// `registerDocumentExporters(register)`, where A's service registers its exporters. What it needs of A beyond the
// ledger's request: `pageSize` on the request (Letter by default, A4 selectable in the Export menu and in
// `artifact_export`, the owner's Decision Log 43), and the governing system's `DesignSystemExport` once D's apply API
// is on the base (the house system's look until then, exactly as the editor draws it without a scope).
import type { Actor } from '@shared/artifacts/actor';
import type { DesignSystemExport, PageSize } from '@artifacts/document/export/design-system';
import { exportDocx } from '@artifacts/document/export/docx';
import { exportHtml } from '@artifacts/document/export/html';
import { exportMarkdown } from '@artifacts/document/export/markdown';
import { exportSource, type ImageLoader } from '@artifacts/document/export/source';
import { applyV2, newDoc } from '@artifacts/yjs';

export const DOCUMENT_EXPORT_FORMATS = ['md', 'html', 'docx', 'pdf'] as const;
export type DocumentExportFormat = (typeof DOCUMENT_EXPORT_FORMATS)[number];

/** What the service asks for (A's `ArtifactExportRequest`, the fields an exporter reads, plus the page size requested of A). */
export interface DocumentExportRequest {
  artifactId: string;
  format: DocumentExportFormat;
  revision: number;
  versionId?: number;
  path: string; // where the file is written
  pageSize?: PageSize; // Letter unless the request chooses A4 or the governing system's page tokens say otherwise
}

/** What the service provides an exporter: the artifact's facts and state, its assets, the capture window, the disk. */
export interface DocumentExportContext {
  title: string;
  /** The document's V2 state at the request's revision, or the version's. */
  state(): Promise<Uint8Array>;
  /** An asset's bytes by the ref an image stores (`assets/<name>`); null when it cannot be had (the image shows its alt text). */
  readAsset(ref: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** The standalone page printed in the capture window: `printToPDF` with the page's own size and margins. */
  printToPdf(html: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  /** The governing design system's export helpers (X28); the house system when absent. */
  system?: DesignSystemExport;
  /** A comment's author as Word names it; the session's title or "Claude", and "Owner", when absent. */
  authorName?(actor: Actor): string;
}

export interface DocumentExporter {
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

const RUN: Record<DocumentExportFormat, DocumentExporter['run']> = {
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
