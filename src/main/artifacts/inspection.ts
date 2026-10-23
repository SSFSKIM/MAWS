// Visual inspection uses the same governed HTML and slide renderers as export, without a visible app window.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSettled, openCaptureWindow, settled } from './capture';
import { printRequestAllowed, type Exporter, type ExporterRegistry, type ExportRequest } from './export';
import { restrictRequests, type SeamEnv } from './policies';
import { renderPresentationSlide, type PresentationExportDeps } from '../presentations/export';

export type RenderDocument = (html: string, request: ExportRequest, signal: AbortSignal) => Promise<Buffer>;

export function documentPngExporter(html: Exporter, render: RenderDocument): Exporter {
  return { kind: 'document', format: 'png', run: async (request, context) => {
    await html.run({ ...request, format: 'html' }, { ...context, writeFile: async (_path, body) => {
      if (typeof body !== 'string') throw new Error('document HTML exporter returned non-text content');
      await context.writeFile(request.path, await render(body, request, context.signal));
    } });
  } };
}

export async function renderDocumentViewport(html: string, request: ExportRequest, signal: AbortSignal, env: SeamEnv): Promise<Buffer> {
  signal.throwIfAborted();
  const dir = await mkdtemp(join(tmpdir(), 'maws-inspect-'));
  let destroy: (() => void) | undefined;
  let unrestrict: (() => void) | undefined;
  try {
    const page = join(dir, 'document.html');
    await writeFile(page, html);
    signal.throwIfAborted();
    const width = request.width ?? 1280;
    // As in the deck renderer, host layout reads need JS enabled. The governed HTML's default-src 'none' CSP
    // grants no script execution to authored content; sandbox and the request filter remain in force.
    const win = openCaptureWindow(width, request.height ?? 800, env);
    destroy = () => { if (!win.isDestroyed()) win.destroy(); };
    signal.addEventListener('abort', destroy, { once: true });
    const url = pathToFileURL(page).href;
    unrestrict = restrictRequests(win.webContents.id, (candidate) => !printRequestAllowed(candidate, url));
    await loadSettled(win, url);
    signal.throwIfAborted();
    // The document exporter emits no scripts; this host-owned expression only waits for fonts, reads bounds and scrolls.
    const fullHeight = await win.webContents.executeJavaScript('document.fonts.ready.then(() => document.documentElement.scrollHeight)') as number;
    if (request.height === undefined) {
      if (fullHeight > 8192) throw new Error('document PNG exceeds 8192 px; use artifact_screenshot with height and offsetY');
      win.setContentSize(width, Math.max(240, Math.ceil(fullHeight)));
    }
    const maxOffset = await win.webContents.executeJavaScript('Math.max(0, document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight)') as number;
    if ((request.offsetY ?? 0) > maxOffset) throw new Error(`offsetY is outside the document viewport (0 to ${maxOffset} px)`);
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${JSON.stringify(request.offsetY ?? 0)})`);
    await settled(win);
    signal.throwIfAborted();
    return (await win.webContents.capturePage()).toPNG();
  } finally {
    if (destroy) signal.removeEventListener('abort', destroy);
    unrestrict?.();
    destroy?.();
    await rm(dir, { recursive: true, force: true });
  }
}

export function registerInspectionExporters(registry: ExporterRegistry, deps: PresentationExportDeps): () => void {
  const html = registry.get('document', 'html');
  const deck = registry.get('presentation', 'png');
  if (!html || !deck) throw new Error('register document and presentation exporters before inspection');
  const offs = [registry.register(documentPngExporter(html, (body, request, signal) => renderDocumentViewport(body, request, signal, deps.env))),
    registry.register({ kind: 'presentation', format: 'png', run: async (request, context) => {
      if (!request.inspection) return deck.run(request, context);
      if (!request.slide) throw new Error('presentation inspection requires a slide id');
      await context.writeFile(request.path, await renderPresentationSlide(request, context, deps, request.slide));
    } })];
  return () => offs.forEach((off) => off());
}
