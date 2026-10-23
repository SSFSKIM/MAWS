// The dashboard kind's exporters in A's export registry (P3-E2 M5 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md;
// parent §2 "Exports", E's Decision Logs 15, 32 and 35; ledger X31): `dashboard` × md, html, docx and pdf are B's four
// document exporters, governed by D's adapter as B's are, each run first handed the views of the state the export
// captured (`prepareViews`, src/artifacts/dashboard/export.ts): the descriptors that state names, their snapshots' rows
// read page by page through the engine host's `artifacts.readDataset` at the descriptors' refs and formats (never a
// live lookup, so a replacement landing during the export changes nothing in it), the export's signal checked before
// and after every page. A snapshot that cannot be read fails the export, as does its cancellation; a held legacy
// dashboard is refused with its files. Word alone takes pictures: each distinct chart's SVG drawn once in a protected
// capture window, with the governing system's faces, as the PNG fallback beside the SVG; a table is never a picture.
// HTML and PDF pages declare the same faces, so a figure's authored family draws as the editor draws it (P3-E Decision
// Log 37; B's own document pages and Word's font embedding are tracked separately). E3 M3 fix: one clock captured with
// the live state labels every view's query staleness, whatever the time its pages arrive; a version's export keeps its
// saved labels.
import { DATASET_LIMITS } from '@artifacts/dashboard/datasets';
import { exportTheme, prepareViews, VIEW_CSS } from '@artifacts/dashboard/export';
import { SnapshotReader } from '@artifacts/dashboard/snapshots';
import { dsOverrides } from '@artifacts/document/meta';
import { defaultAuthorName } from '@artifacts/document/export/source';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { ArtifactHost, DatasetPage } from '@artifacts/host';
import { DOCUMENT_EXPORTERS, withDocumentAuthors, type DocumentAuthorDeps, type DocumentExportContext, type DocumentExporter, type DocumentExportRequest } from '../artifacts/export-document';
import type { SeamEnv } from '../artifacts/policies';
import { governDocumentExporter, type HostCall } from '../design-systems/documents';
import { deckSystem, systemFacesCss } from '../presentations/export';
import { openFigurePictures, type OpenPictures } from './pictures';

export type { OpenPictures } from './pictures';

export interface DashboardExportDeps extends DocumentAuthorDeps {
  /** The engine host's commands (the governing system, the snapshots' pages, the system's faces). */
  call: HostCall;
  env: SeamEnv;
  /** Word's picture window; the protected capture window by default. */
  pictures?: OpenPictures;
}

const cancelled = () => new Error('the export was cancelled');

/** The host's pages of one snapshot for this export: its signal checked around every page, a refusal a failure. */
function pagesOf(call: HostCall, signal: AbortSignal): Pick<ArtifactHost, 'readDataset'> {
  return {
    readDataset: async (artifactId, ref, { format, offset, limit }): Promise<DatasetPage> => {
      if (signal.aborted) throw cancelled();
      const result = await call('artifacts.readDataset', { artifactId, ref, format, ...(offset !== undefined && { offset }), ...(limit !== undefined && { limit }) });
      if (signal.aborted) throw cancelled();
      if (!result.ok) throw new Error(`the snapshot ${ref} could not be read: ${result.error.message}`);
      return result.value;
    },
  };
}

/** B's `exporter` run for a dashboard: the captured state's views prepared, then B's run with them. */
function dashboardExporter(exporter: DocumentExporter, deps: DashboardExportDeps): DocumentExporter {
  const pictures = deps.pictures ?? openFigurePictures(deps.env);
  return {
    kind: 'dashboard',
    format: exporter.format,
    run: async (request: DocumentExportRequest, context: DocumentExportContext) => {
      if (context.signal.aborted) throw cancelled();
      const doc = newDoc();
      // the governing system's faces under their authored names, their files inlined (P3-E Decision Log 37): the names
      // the figures carry; read once per run, and only by a format that draws (HTML and PDF pages, Word's pictures)
      let faces: Promise<string> | null = null;
      const facesCss = () => (faces ??= (async () => systemFacesCss(await deckSystem(request, deps), deps))());
      // Word's pictures: the window opened at the first chart, closed when the run ends
      const window = exporter.format === 'docx' ? pictures({ signal: context.signal, facesCss }) : null;
      // P4 L287: the data's updater in every label, and a comment's author in Word, a session named by its title
      const authorName = context.authorName ?? defaultAuthorName;
      try {
        applyV2(doc, await context.state());
        const now = request.versionId === undefined ? Date.now() : undefined; // E3 M3 fix: the export's one clock
        const reader = new SnapshotReader(pagesOf(deps.call, context.signal), request.artifactId, DATASET_LIMITS.datasets);
        const renderView = await prepareViews(doc, {
          read: (snapshot) => reader.read(snapshot),
          theme: exportTheme(context.system, dsOverrides(doc)),
          authorName,
          ...(now !== undefined && { now }), // E3 M3 fix
          ...(window && { picture: (svg: string, size: { width: number; height: number }) => window.take(svg, size) }),
        });
        if (context.signal.aborted) throw cancelled();
        const pageFaces = exporter.format === 'html' || exporter.format === 'pdf' ? await facesCss() : '';
        if (context.signal.aborted) throw cancelled();
        await exporter.run(request, { ...context, authorName, renderView, viewCss: `${pageFaces}${VIEW_CSS}` });
      } finally {
        window?.close();
        doc.destroy();
      }
    },
  };
}

/** Registers the dashboard's four exporters, each governed by D, through `register` (A's registry); returns their removal. */
export function registerDashboardExporters(register: (exporter: DocumentExporter) => () => void, deps: DashboardExportDeps): () => void {
  const offs = DOCUMENT_EXPORTERS.map((exporter) => register(governDocumentExporter(withDocumentAuthors(dashboardExporter(exporter, deps), deps), deps.call)));
  return () => offs.forEach((off) => off());
}
