// The document exporters' e2e seam in main (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md), MAWS_E2E=1
// only: `globalThis.__maws_document_export.export({title, state, format, path, pageSize?})` runs the document exporter
// for `format` over a V2 state (base64) with the real PDF route, the hidden capture window's `printToPDF`, and writes
// the file; `print(html, path)` runs the PDF route alone. A's export service (its M7) is not on this branch's base, so
// nothing in the app reaches the exporters yet; this is how `e2e/document.spec.ts` proves they bundle and run in main and that the PDF prints with the page count
// and paper its fixture expects. It goes when A's service registers the exporters (`registerDocumentExporters`) and the
// spec exports through the Export menu and `artifact_export` instead. The exporters load on the first call, so a
// launch that never exports never loads them.
import { writeFile } from 'node:fs/promises';
import type { PageSize } from '@artifacts/document/export/design-system';

interface SeamRequest {
  title: string;
  state: string; // base64 of the document's V2 state
  format: 'md' | 'html' | 'docx' | 'pdf';
  path: string;
  pageSize?: PageSize;
}

export function startDocumentExportSeam(env: Record<string, string | undefined>): () => void {
  if (env.MAWS_E2E !== '1') return () => {};
  const seam = globalThis as { __maws_document_export?: { export(request: SeamRequest): Promise<void>; print(html: string, path: string): Promise<void> } };
  seam.__maws_document_export = {
    // the PDF route alone, over a page the spec writes (one far past a `data:` URL's 2 MB)
    async print(html, path) {
      const { printHtmlToPdf } = await import('./export-pdf');
      await writeFile(path, await printHtmlToPdf(html));
    },
    async export({ title, state, format, path, pageSize }) {
      const [{ DOCUMENT_EXPORTERS }, { printHtmlToPdf }] = await Promise.all([import('./export-document'), import('./export-pdf')]);
      const exporter = DOCUMENT_EXPORTERS.find((e) => e.format === format);
      if (!exporter) throw new Error(`no document exporter for ${format}`);
      await exporter.run(
        { artifactId: 'e2e', format, revision: 0, path, ...(pageSize ? { pageSize } : {}) },
        {
          title,
          state: async () => new Uint8Array(Buffer.from(state, 'base64')),
          readAsset: async () => null,
          printToPdf: printHtmlToPdf,
          writeFile: (to, data) => writeFile(to, data),
        },
      );
    },
  };
  return () => {
    delete seam.__maws_document_export;
  };
}
