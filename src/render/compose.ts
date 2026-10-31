// The render library's root (P5 O5 M3; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M3, "One library, two
// roots, one registration rule"): the capture and export code, composed one way for both of its roots. Main's embedded
// root composes it in-process (src/main/artifacts/index.ts), answering its engine host's capture and export events and
// registering `artifacts.export`; the render host (src/render-host/root.ts) composes it in a windowless process that
// `mawsd` hands each request to. `composeRender` renders and registers nothing on IPC: each root wires what reaches it.
//
// What a root supplies: the engine host's commands (`call`: main's host dispatch, or the render host's `machine.sock`
// client through its typed adapter), the content lookup the capture and the html exporters resolve a page through, the
// store's directory the library's exports are written under, and the environment the e2e's seams read. The authors of a
// document's Word comments (`authors`: the session titles and the person's export name) are the embedded root's; a root
// without them writes the exporters' defaults. `hostGeneration` is the embedded root's count of its engine host's
// connection losses (E3's one recapture of a dashboard export across a restart); a root without it never retries.
import type { MawsArtifactCapture, MawsArtifactCapturedResult, MawsArtifactExport, MawsArtifactExportAnswer } from '@shared/ipc/schema/maws';
import { createCaptureService } from './capture';
import { registerDashboardExporters } from './dashboard/export';
import { registerDesignExporters } from './design/export';
import { governDocumentExporter, type HostCall } from './design-systems/documents';
import { registerDesignSystemExporters } from './design-systems/export';
import { ExporterRegistry, createExportService, registerHtmlExporters, type ExportService } from './export';
import { registerDocumentExporters, type DocumentAuthorDeps } from './export-document';
import { registerInspectionExporters } from './inspection';
import type { SeamEnv } from './policies';
import { registerPresentationExporters } from './presentations/export';
import type { ContentLookup } from './scheme';

export type { HostCall } from './design-systems/documents';

export interface RenderDeps {
  call: HostCall; // the engine host's commands
  content: ContentLookup; // `artifacts.content`, through `call` in both roots
  root: string; // `<profile>/artifacts`, the store's directory, where the library's exports are written
  env: SeamEnv;
  authors?: DocumentAuthorDeps;
  hostGeneration?: () => number;
}

export interface Render {
  capture(request: MawsArtifactCapture): Promise<MawsArtifactCapturedResult>; // never rejects
  export(request: MawsArtifactExport): Promise<MawsArtifactExportAnswer>; // never rejects
  exportForLibrary: ExportService['exportForLibrary']; // rejects with a HostCommandError the router answers as named
  exporters: ExporterRegistry;
  stop(): void; // the exporters withdrawn
}

export function composeRender({ call, content, root, env, authors = {}, hostGeneration }: RenderDeps): Render {
  const exporters = new ExporterRegistry();
  // in this order: inspection wraps the document's html and the presentation's png exporters
  const withdraw = [
    registerHtmlExporters(exporters, { content, env }), // P3-A M7: an html artifact's PDF and PNG
    registerDocumentExporters((exporter) => exporters.register(governDocumentExporter(exporter, call)), authors), // P3-B, P3-D; WR 73
    registerDesignSystemExporters(exporters), // P3-D M7: `design_system` as `claude`
    registerPresentationExporters(exporters, { call, env }), // P3-C M9
    registerInspectionExporters(exporters, { call, env }),
    registerDashboardExporters((exporter) => exporters.register(exporter), { call, env, ...authors }), // P3-E (E2 M5); WR 73
    registerDesignExporters(exporters, { call, env }), // P3-E (E1's M5)
  ];
  const exports = createExportService({ registry: exporters, root, call, ...(hostGeneration && { hostGeneration }) });
  const capture = createCaptureService({ content, env });
  return {
    capture,
    export: (request) => exports.export(request),
    exportForLibrary: (input, options) => exports.exportForLibrary(input, options),
    exporters,
    stop: () => {
      for (const off of withdraw.reverse()) off();
    },
  };
}
